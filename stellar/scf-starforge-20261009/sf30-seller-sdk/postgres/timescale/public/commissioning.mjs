// MIT. Industrial commissioning desk on the original Timescale listener.
import { timescaleHost } from '/timescale/app.mjs';
const root=document.createElement('section');root.id='timescale-commissioning';root.className='panel tc-desk';
const state={workspace:null,detail:null,context:null,edition:null,comparison:null,pending:null,pendingState:null,lastOperation:null,
  offset:0,contextOffset:0,comparisonOffset:0,reportOffset:0,busy:false,polling:false,db:null,key:null};
const el=(tag,text='',props={})=>{const value=document.createElement(tag);value.textContent=text;for(const[k,v]of Object.entries(props))value.setAttribute(k,v);return value;};
function group(title,parent=root,collapsible=false){const value=el(collapsible?'details':'section');value.append(el(collapsible?'summary':'h3',title));parent.append(value);return value;}
function field(parent,label,{tag='input',...attributes}={}){const wrap=el('label',label),input=el(tag,'',attributes);wrap.append(input);parent.append(wrap);return input;}
function button(parent,label,fn,attributes={}){const value=el('button',label,{type:'button',...attributes});value.onclick=()=>act(fn);parent.append(value);return value;}
function link(parent,label,path){const value=el('a',label,{href:path});parent.append(value);return value;}
function form(parent,title,fn){const box=group(title,parent),value=el('form');box.append(value);value.onsubmit=event=>{event.preventDefault();act(()=>fn(event));};return value;}
function submit(parent,label){parent.append(el('button',label,{type:'submit','data-mutation':'true'}));}
function options(control,rows,label,value,blank='Select…'){const old=control.value;control.replaceChildren(el('option',blank,{value:''}));for(const row of rows)control.append(el('option',label(row),{value:String(value(row))}));if([...control.options].some(x=>x.value===old))control.value=old;}
function table(columns,rows){const result=el('table'),head=el('tr'),body=el('tbody');for(const column of columns)head.append(el('th',column));const thead=el('thead');thead.append(head);result.append(thead,body);
  for(const row of rows){const tr=el('tr');for(const cell of row)tr.append(el('td',cell===null?'NULL':String(cell??'')));body.append(tr);}return result;}
function showError(error){notice.textContent=error?.message??String(error);}
async function api(path,input){
  const response=await fetch('/api/timescale/'+path,input===undefined?{}:{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(input)});
  let value;try{value=await response.json();}catch{throw new Error('The original request did not return readable JSON. Inspect its saved identity.');}
  if(!response.ok)throw Object.assign(new Error(value.message??value.error??'The original operation did not return.'),{code:value.error,status:response.status});
  return value;
}
const desk=(path,input)=>api('commissioning/'+path,input);
const url=(path,args={})=>'/api/timescale/commissioning/'+path+'?'+new URLSearchParams(args);
async function originalText(file){
  try{return new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(await file.arrayBuffer());}
  catch{throw new Error('The complete original source must be valid UTF-8. Export the native JSON in UTF-8 without replacing characters.');}
}
async function localStore(value){
  if(!state.db||!state.key)throw new Error('This browser cannot retain the original request. Enable site storage or use the original command line.');
  return new Promise((resolve,reject)=>{const tx=state.db.transaction('requests','readwrite');tx.objectStore('requests').put(value,state.key);tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error??new Error('The original request was not retained.'));});
}
async function persist(){await localStore({pending:state.pending,lastOperation:state.lastOperation,selectedId:state.detail?.item.id??null,actor:actor.value,note:note.value});}
async function openStorage(){
  state.db=await new Promise((resolve,reject)=>{const request=indexedDB.open('stellar-timescale-commissioning',1);request.onupgradeneeded=()=>request.result.createObjectStore('requests');request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
  return new Promise((resolve,reject)=>{const tx=state.db.transaction('requests'),request=tx.objectStore('requests').get(state.key);request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);});
}
function controls(){
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
  if(!actor.value.trim()||!note.value.trim())throw new Error('Name the operator and purpose of this change.');
  const value={action,actor:actor.value,note:note.value,...extra};
  if(action!=='create'){
    if(!state.detail)throw new Error('Open a commissioning project.');
    value.commissioningId=state.detail.item.id;value.expectedRevision=state.detail.item.revision;
  }
  return value;
}
async function send(path,input){
  if(state.pending)throw new Error('Continue or reconcile the saved original request first.');
  if(timescaleHost.hasPending())throw new Error('The original Timescale workspace has an active or saved request. Open its operator controls to finish it.');
  const snapshot=await api('status?limit=1&offset=0');state.workspace=snapshot;
  state.pending={path,input:{requestId:crypto.randomUUID(),expectedVersion:snapshot.version,...input}};
  state.pendingState=null;
  // IndexedDB retains the complete upload before POST. The server stores its
  // content once and binds the original UUID to its full digest and byte count.
  await persist();await continueRequest();
}
async function command(action,input){return send('commissioning/command',changeFields(action,input));}
async function inspectPending(){
  if(!state.pending)return null;
  const id=state.pending.input.requestId;
  try{
    const row=await api('operation?id='+encodeURIComponent(id));state.pendingState=row.state;state.lastOperation=id;
    operationView.textContent=JSON.stringify(row,null,2);
    if(row.state==='COMPLETE'){
      const result=row.data.result,selected=result?.commissioningId??state.detail?.item.id;
      state.pending=null;state.pendingState=null;await persist();
      if(selected)await openProject(selected,false);
      await persist();
      if(result?.schema==='stellar-forge.timescale-commissioning-report-export.v1')renderReportLinks(row.id,result);
      notice.textContent='Original request complete. Its full outcome is retained in the workspace.';
    }
    return row;
  }catch(error){if(error.code==='TIMESCALE_OPERATION_NOT_FOUND'){state.pendingState='NOT_FOUND';return null;}throw error;}
}
async function continueRequest(){
  if(!state.pending)return;
  const row=await inspectPending();if(!state.pending)return;
  if(row&&['RUNNING','DISPATCHING','OUTCOME_UNKNOWN'].includes(row.state)){notice.textContent='Original request '+row.state+'. Keep this identity and inspect its native outcome.';return;}
  state.workspace=await api('status?limit=1&offset=0');
  state.pending.input.expectedVersion=state.workspace.version;await persist();
  const saved=state.pending;
  try{const response=await api(saved.path,saved.input);state.lastOperation=response.id;await persist();}
  catch(error){await inspectPending().catch(()=>{});throw error;}
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
  const file=intakeUpload.files?.[0];if(!file)throw new Error('Choose the complete original intake JSON.');
  if(file.size>1048576)throw new Error('The original intake exceeds 1 MiB.');
  await command('create',{intake:{filename:file.name,content:await originalText(file)},owner:newOwner.value,...(newTitle.value?{title:newTitle.value}:{})});
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
  const file=sourceUpload.files?.[0];if(!file)throw new Error('Choose the complete original native JSON source.');
  if(file.size>6291456)throw new Error('The original source exceeds 6 MiB. Use the complete agreed window in the native export.');
  await command('import-table',{source:{filename:file.name,content:await originalText(file),tableName:tableName.value||null},role:sourceRole.value,title:sourceTitle.value});
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
  if(!state.observedOperation)throw new Error('Open the original native operation.');
  await command('observe',{operationId:state.observedOperation.operation.id,operationDigest:state.observedOperation.digest,relevance:relevance.value});
});
const operationKind=field(observe,'Native operation kind',{tag:'select'});operationKind.append(el('option','All',{value:''}));
for(const kind of ['capture','review','prepare-refresh','refresh','verification','prepare-job','job-change','select-aggregate','extraction','remediation'])operationKind.append(el('option',kind,{value:kind}));
const operationSelect=field(observe,'Original operation',{tag:'select',required:''});button(observe,'Open native outcome',async()=>{
  state.observedOperation=await desk('operation?id='+encodeURIComponent(operationSelect.value));nativeOutcome.textContent=JSON.stringify(state.observedOperation.operation,null,2);
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
  state.pending=null;state.pendingState=null;await persist();notice.textContent='The prior request remains in history. New edited work can now receive its own request identity.';await refresh();
});
const operationView=el('pre');recovery.append(operationView);
document.getElementById('timescale-workspace').after(root);

async function refreshList(){
  const result=await desk('list?'+new URLSearchParams({offset:state.offset,limit:25,q:query.value}));
  const value=table(['Project','Owner','State','Criteria','Sources','Open'],result.items.rows.map(x=>[x.title,x.owner,x.status,x.passed+'/'+x.criteria,x.sources,'']));
  [...value.tBodies[0].rows].forEach((row,index)=>button(row.cells[5],'Open',()=>openProject(result.items.rows[index].id)));
  projectList.replaceChildren(value);listCount.textContent=(result.items.total?state.offset+1:0)+'–'+Math.min(state.offset+25,result.items.total)+' of '+result.items.total;
  previous.disabled=state.offset===0;next.disabled=result.items.next===null;
}
function currentSources(role){return state.detail.item.sources.filter(x=>x.contractRevision===state.detail.item.contractRevision&&(!role||x.role===role));}
function renderProject(){
  const item=state.detail.item;project.hidden=false;
  projectSummary.textContent=item.title+' · '+item.status.replaceAll('_',' ')+' · revision '+item.revision+' · source contract '+item.contractRevision;
  editTitle.value=item.title;editOwner.value=item.owner;newOwner.value||=item.owner;decisionOwner.value||=item.owner;
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
  options(criterion,item.acceptance,x=>x.id+' · '+x.title,x=>x.id);renderCriterion();
  handoverView.textContent=item.handover?JSON.stringify(item.handover,null,2):'No technical handover has been recorded for the current project.';
  historyView.replaceChildren(table(['Revision','Action','Operator','Purpose','Saved'],state.detail.history.map(x=>[x.revision,x.action,x.actor,x.note,x.at])));
  for(const button of project.querySelectorAll('form button[type=submit]'))if(![exportForm].includes(button.form))button.setAttribute('data-edit','true');
  controls();
}
async function openProject(id,persistSelection=true){
  const changed=state.detail?.item.id!==id;state.detail=await desk('item?id='+encodeURIComponent(id));
  if(changed){state.contextOffset=0;state.reportOffset=0;state.comparison=null;state.comparisonOffset=0;mapping.replaceChildren();ignoredObserved.replaceChildren();comparisonView.replaceChildren();reportLinks.replaceChildren();}
  renderProject();await loadContext();await loadReports();if(persistSelection)await persist();
}
async function loadContext(){
  if(!state.detail)return;
  state.context=await desk('context?'+new URLSearchParams({id:state.detail.item.id,offset:state.contextOffset,limit:25,...(operationKind.value?{kind:operationKind.value}:{})}));
  options(editionSelect,state.context.editions.rows,x=>x.title+' · '+x.created,x=>x.id);
  options(operationSelect,state.context.operations.rows.filter(x=>!x.kind.startsWith('commissioning')),x=>x.kind+' · '+x.state+' · '+x.id,x=>x.id);
  catalogCount.textContent='From '+state.contextOffset+' · '+state.context.editions.total+' editions · '+state.context.operations.total+' operations';
}
async function openEdition(){
  if(!editionSelect.value)throw new Error('Choose a retained edition on this source page.');
  state.edition=await api('edition?id='+encodeURIComponent(editionSelect.value));editionSummary.textContent=state.edition.record.title+' · '+state.edition.catalog.length+' native continuous aggregates';
  options(aggregate,state.edition.catalog,x=>x.schema+'.'+x.name,x=>x.key);renderAggregate();
}
function renderAggregate(){
  const value=state.edition?.catalog.find(x=>x.key===aggregate.value);options(timeColumn,value?.columns??[],x=>x.name+' · '+x.type,x=>x.name);
  columns.replaceChildren(el('legend','Published native columns'));
  for(const row of value?.columns??[]){const wrap=el('label'),input=el('input','',{type:'checkbox',value:row.name});input.checked=true;wrap.append(input,document.createTextNode(row.name));columns.append(wrap);}
  const first=value?.columns.find(x=>[20,21,23,1082,1114,1184].includes(Number(x.oid)));if(first){timeColumn.value=first.name;renderTimeType();}
}
function renderTimeType(){const value=state.edition?.catalog.find(x=>x.key===aggregate.value)?.columns.find(x=>x.name===timeColumn.value),types={20:'bigint',21:'smallint',23:'integer',1082:'date',1114:'timestamp without time zone',1184:'timestamp with time zone'};if(types[value?.oid])timeType.value=types[value.oid];}
function selectionInput(){
  if(!state.edition||!aggregate.value)throw new Error('Open the exact retained edition and aggregate.');
  return {editionId:state.edition.value.id,editionDigest:state.edition.record.digest,aggregateKey:aggregate.value,
    timeColumn:timeColumn.value,timeType:timeType.value,start:start.value,end:end.value,timezone:timezone.value,
    title:state.detail.item.title,owner:state.detail.item.owner,note:note.value,
    columns:[...columns.querySelectorAll('input:checked')].map(x=>x.value)};
}
function renderMapping(){
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
  if(!state.comparison)return;
  const result=await desk('comparison?'+new URLSearchParams({id:state.detail.item.id,comparison:state.comparison,offset:state.comparisonOffset,limit:25}));
  comparisonView.replaceChildren(el('p',(result.matches?'Exact match':'Differences')+' · '+result.counts.expectedRows+' baseline rows · '+result.counts.observedRows+' observed rows · '+result.counts.matchedRows+' matching rows'));
  comparisonView.append(el('pre',JSON.stringify(result.mapping,null,2)));
  for(const [key,label]of [['expectedOnly','Baseline-only rows'],['observedOnly','Observed-only rows']]){
    comparisonView.append(el('h4',label),table([...result.mapping.columns.map(x=>x.name),'Count'],result[key].rows.map(x=>[...x.values.map(v=>JSON.stringify(v)),x.count])));
  }
  link(comparisonView,'Download every difference',url('comparison-file',{id:state.detail.item.id,comparison:state.comparison}));
  comparisonCount.textContent='Page offset '+state.comparisonOffset+' · '+result.expectedOnly.total+' baseline-only groups · '+result.observedOnly.total+' observed-only groups';
}
function renderCriterion(){
  const selected=state.detail?.item.acceptance.find(x=>x.id===criterion.value);condition.textContent=selected?[selected.condition,selected.expectedSource].filter(Boolean).join('\n'):'Choose the original acceptance criterion.';
  if(selected){decisionValue.value=selected.decision;decisionOwner.value=selected.owner||state.detail.item.owner;assessment.value=selected.assessment;}
  references.replaceChildren(el('legend','Current contract sources and outcomes'));
  if(!state.detail)return;
  for(const [kind,key]of [['source','sources'],['comparison','comparisons'],['observation','observations']]){
    for(const value of state.detail.item[key].filter(x=>x.contractRevision===state.detail.item.contractRevision)){
      const wrap=el('label'),input=el('input','',{type:'checkbox',value:JSON.stringify({kind,id:value.id})});
      input.checked=Boolean(selected?.references.some(x=>x.kind===kind&&x.id===value.id));
      wrap.append(input,document.createTextNode(kind+' · '+(value.title??value.kind)+' · '+value.id));references.append(wrap);
    }
  }
}
function renderReportLinks(id,result){reportLinks.replaceChildren(el('span','Frozen report · revision '+result.revision));
  link(reportLinks,'Complete JSON',url('report-file',{id,format:'json'}));link(reportLinks,'Printable HTML',url('report-file',{id,format:'html'}));}
async function loadReports(){
  if(!state.detail)return;
  const result=await desk('reports?'+new URLSearchParams({id:state.detail.item.id,offset:state.reportOffset,limit:25}));
  const value=table(['Revision','Published','Complete report files'],result.reports.rows.map(x=>[x.revision,x.createdAt,'']));
  [...value.tBodies[0].rows].forEach((row,index)=>{const item=result.reports.rows[index];link(row.cells[2],'JSON',url('report-file',{id:item.requestId,format:'json'}));link(row.cells[2],'Printable HTML',url('report-file',{id:item.requestId,format:'html'}));});
  publishedReports.replaceChildren(value);reportsCount.textContent=state.reportOffset+'–'+Math.min(state.reportOffset+25,result.reports.total)+' of '+result.reports.total;
}
async function refresh({project:reloadProject=false}={}){
  if(state.polling)return;state.polling=true;
  try{
    state.workspace=await api('status?limit=1&offset=0');await refreshList();
    if(reloadProject&&state.detail)await openProject(state.detail.item.id,false);
    if(state.pending)await inspectPending();
    recoveryText.textContent=state.pending?'Saved request '+state.pending.input.requestId+' · '+(state.pendingState??'Awaiting original acknowledgement'):'No pending commissioning request.';
    if(state.lastOperation&&!state.pending){
      const row=await api('operation?id='+encodeURIComponent(state.lastOperation));operationView.textContent=JSON.stringify(row,null,2);
      if(row.kind==='commissioning-report'&&row.state==='COMPLETE'&&row.data.result.commissioningId===state.detail?.item.id)renderReportLinks(row.id,row.data.result);
    }
  }finally{state.polling=false;controls();}
}
query.onsearch=()=>act(async()=>{state.offset=0;await refreshList();});
query.onchange=query.onsearch;aggregate.onchange=renderAggregate;timeColumn.onchange=renderTimeType;
operationKind.onchange=()=>act(async()=>{state.contextOffset=0;await loadContext();});
criterion.onchange=renderCriterion;
actor.onchange=note.onchange=()=>persist().catch(showError);
await act(async()=>{
  state.workspace=await api('status?limit=1&offset=0');state.key=state.workspace.id;
  const saved=await openStorage();if(saved){state.pending=saved.pending??null;state.lastOperation=saved.lastOperation??null;actor.value=saved.actor??'';note.value=saved.note??'';if(saved.selectedId)await openProject(saved.selectedId,false);}
  await refresh();
});
setInterval(()=>{if(!state.busy)refresh().catch(showError);},5000);
