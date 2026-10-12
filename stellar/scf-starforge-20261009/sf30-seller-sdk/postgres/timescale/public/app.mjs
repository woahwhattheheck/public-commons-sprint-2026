import { publisherHost } from '/app.mjs';
const panel=document.createElement('section');panel.id='timescale-workspace';panel.className='panel';
function node(tag,text='',props={}){const item=document.createElement(tag);item.textContent=text;for(const[k,v]of Object.entries(props))item.setAttribute(k,v);return item;}
const controls={};
function field(id,label,{tag='input',...props}={},parent){
  const wrap=node('label',label),input=node(tag,'',{id:'ts-'+id,...props});controls[id]=input;wrap.append(input);parent.append(wrap);return input;
}
function button(id,label,parent,callback){const value=node('button',label,{type:'button',id:'ts-'+id});controls[id]=value;parent.append(value);if(callback)value.onclick=()=>action(callback);return value;}
function section(title,parent=panel){const item=node('section');item.append(node('h3',title));parent.append(item);return item;}
function form(id,title,parent=panel){const item=section(title,parent),form=node('form','',{id:'ts-'+id});controls[id]=form;item.append(form);return form;}
function details(title){const item=node('details');item.append(node('summary',title));panel.append(item);return item;}
function submitButton(text,parent,mode){const value=node('button',text,{type:'submit',...(mode?{name:'mode',value:mode}:{})});parent.append(value);return value;}
const heading=node('div','',{class:'section-heading'});heading.append(node('h2','Timescale operations'));panel.append(heading);
button('reload','Refresh project',heading,()=>refresh());
const context=node('p','',{class:'muted'}),notice=node('p','',{role:'status'});panel.append(context,notice);
const grid=node('div','',{class:'ts-grid'});panel.append(grid);
const capture=form('capture','Capture a complete edition',grid);
field('capture-title','Edition name',{required:'',maxlength:'128'},capture);
field('capture-note','Purpose',{required:'',maxlength:'2000'},capture);
submitButton('Capture native state',capture);
const sourceArea=section('Retained source',capture.parentElement);
field('edition','Edition',{tag:'select'},sourceArea);
button('open-edition','Open edition',sourceArea,()=>loadEdition());
button('download-edition','Download edition',sourceArea,async()=>downloadEdition());
const summary=node('p','',{class:'muted'});sourceArea.append(summary);
const windowForm=form('window','Select an aggregate and window',grid);
field('aggregate','Continuous aggregate',{tag:'select',required:''},windowForm);
const windowGrid=node('div','',{class:'two'});windowForm.append(windowGrid);
field('time-column','Time column',{tag:'select',required:''},windowGrid);
const timeType=field('time-type','Native time type',{tag:'select'},windowGrid);
for(const type of ['timestamp with time zone','timestamp without time zone','date','smallint','integer','bigint'])timeType.append(node('option',type));
field('start','Window start',{required:'',placeholder:'2026-10-01T00:00:00Z'},windowGrid);
field('end','Window end, exclusive',{required:'',placeholder:'2026-10-02T00:00:00Z'},windowGrid);
field('timezone','Timezone',{required:'',value:'UTC'},windowGrid);
field('title','Operation name',{required:'',maxlength:'128'},windowGrid);
field('owner','Responsible operator',{required:'',maxlength:'128'},windowGrid);
field('note','Purpose',{required:'',maxlength:'2000'},windowGrid);
const projected=node('div','',{class:'ts-checks'});windowForm.append(node('p','Published columns'),projected);
const options=node('details');options.append(node('summary','Native refresh options'));windowForm.append(options);
field('batch','Buckets per batch',{type:'number',value:'10',min:'0',max:'2147483647'},options);
field('max-batches','Maximum batches; 0 for all',{type:'number',value:'0',min:'0',max:'2147483647'},options);
field('newest','Refresh newest buckets first',{type:'checkbox',checked:''},options);
field('force','Force already materialized buckets to refresh',{type:'checkbox'},options);
options.append(node('p','Each native batch commits independently. Choose 0 buckets per batch for one atomic window. Compare the completed aggregate after refreshing.',{class:'muted'}));
submitButton('Prepare native refresh',windowForm,'refresh');submitButton('Save aggregate for publication',windowForm,'select');
const native=details('Explore all captured native tables');
field('table','Captured table',{tag:'select'},native);field('search','Search every row',{type:'search'},native);
const tableView=node('div','',{class:'table-wrap'}),tableNav=node('nav','',{class:'pagination'});native.append(tableView,tableNav);
button('rows-prev','Previous rows',tableNav,async()=>{state.tableOffset=Math.max(0,state.tableOffset-40);renderTable();});
const tableCount=node('span');tableNav.append(tableCount);
button('rows-next','Next rows',tableNav,async()=>{state.tableOffset+=40;renderTable();});
const second=node('div','',{class:'ts-grid'});panel.append(second);
const planned=section('Apply a saved operation',second);
field('plan','Saved plan',{tag:'select'},planned);
button('open-plan','Open plan',planned,()=>loadPlan());
button('run-plan','Run native change',planned,()=>send(state.plan?.kind==='job'?'job/apply':'refresh/run',planInput()));
button('verify','Compare complete aggregate results',planned,()=>send('verify',planInput()));
button('extract','Extract to publisher',planned,()=>send('extract',planInput()));
const planView=node('pre');planned.append(planView);
const job=form('job','Change a native job schedule',second);
field('job-id','Job',{tag:'select',required:''},job);
for(const[key,label]of [['schedule_interval','Schedule interval'],['timezone','Timezone'],['max_runtime','Maximum runtime'],['retry_period','Retry interval'],['next_start','Next start with UTC offset']])
  field('job-'+key,label,{name:key,placeholder:'Leave blank to keep current'},job);
field('job-max_retries','Maximum retries',{name:'max_retries',type:'number',min:'-1'},job);
const scheduled=field('job-scheduled','Scheduled',{tag:'select',name:'scheduled'},job);
for(const[value,label]of [['','Keep current'],['true','Yes'],['false','No']])scheduled.append(node('option',label,{value}));
field('job-config','Native configuration JSON',{tag:'textarea',name:'config',rows:'3',placeholder:'Leave blank to keep current'},job);
job.append(node('p','Use the operation name, owner and purpose entered above.',{class:'muted'}));submitButton('Prepare job change',job);
const comparisonArea=details('Compare editions and assign decisions');
const comparisonForm=node('form');comparisonArea.append(comparisonForm);
field('before','Before',{tag:'select',required:''},comparisonForm);field('after','After',{tag:'select',required:''},comparisonForm);submitButton('Compare complete editions',comparisonForm);
const comparisonSummary=node('p'),decisions=node('div','',{class:'ts-decisions'});comparisonArea.append(comparisonSummary,decisions);
button('save-review','Save all review decisions',comparisonArea,async()=>{
  if(!state.comparison)throw new Error('Compare editions first.');
  const rows=[...decisions.querySelectorAll('fieldset')].map(el=>({changeKey:el.dataset.key,
    decision:el.querySelector('select').value,owner:el.querySelector('[name=owner]').value,note:el.querySelector('[name=note]').value}));
  await send('review',{beforeId:state.comparison.before,afterId:state.comparison.after,comparisonDigest:state.comparison.digest,
    reviewer:controls.owner.value,note:controls.note.value,decisions:rows});
});
const exportForm=form('export','Complete project handover');
field('output','New private package directory',{required:'',placeholder:'/private/handover/timescale-oct12'},exportForm);
submitButton('Export workspace and complete dataset',exportForm);
const historyArea=section('Operations and retained outcomes'),history=node('div','',{class:'table-wrap'}),historyNav=node('nav','',{class:'pagination'});historyArea.append(history,historyNav);
button('history-prev','Previous history',historyNav,async()=>{state.offset=Math.max(0,state.offset-25);await refresh();});
const historyCount=node('span');historyNav.append(historyCount);
button('history-next','Next history',historyNav,async()=>{state.offset+=25;await refresh();});
button('continue','Continue saved request',historyArea,()=>continueRequest());
button('cancel','Cancel running operation',historyArea,async()=>{await api('cancel',{id:state.status.active.id});await refresh();});
const output=node('pre');historyArea.append(output);
document.querySelector('main').prepend(panel);
document.title='Timescale operations and dataset publisher';document.querySelector('header h1').textContent='Timescale operations and dataset publisher';
const state={status:null,edition:null,plan:null,comparison:null,offset:0,tableOffset:0,pending:null,lastOperation:null,busy:false,polling:false,storage:null};
async function api(path,input){
  const response=await fetch('/api/timescale/'+path,input===undefined?{}:{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(input)});
  const value=await response.json();if(!response.ok)throw Object.assign(new Error(value.message??value.error),{code:value.error});return value;
}
function persist(){
  if(!state.storage)return;
  const fields=Object.fromEntries(Object.entries(controls).filter(([,x])=>['INPUT','TEXTAREA','SELECT'].includes(x.tagName)).map(([key,x])=>[key,{value:x.value,checked:x.type==='checkbox'?x.checked:undefined}]));
  try{sessionStorage.setItem(state.storage,JSON.stringify({pending:state.pending,lastOperation:state.lastOperation,editionId:state.edition?.value.id,planId:state.plan?.id,fields}));}catch{}
}
function optionsFor(control,rows,text,value){
  const previous=control.value;control.replaceChildren(node('option','Select…',{value:''}));
  for(const row of rows)control.append(node('option',text(row),{value:String(value(row))}));
  if([...control.options].some(x=>x.value===previous))control.value=previous;
}
function buttons(){
  const running=Boolean(state.status?.active),busy=state.busy||running;
  for(const button of panel.querySelectorAll('form button'))button.disabled=busy;
  controls['run-plan'].disabled=busy||!['refresh','job'].includes(state.plan?.kind);
  controls.verify.disabled=busy||!['refresh','projection'].includes(state.plan?.kind);
  controls.extract.disabled=busy||state.plan?.kind!=='projection';
  controls['save-review'].disabled=busy||!state.comparison;
  controls.continue.disabled=state.busy||!state.pending;controls.cancel.disabled=!running;
  controls['download-edition'].disabled=!state.edition;
}
async function action(callback){if(state.busy)return;state.busy=true;buttons();try{await callback();}catch(error){notice.textContent=error.message;}finally{state.busy=false;buttons();}}
async function send(path,input){
  if(state.pending)throw new Error('Continue the saved request before starting another operation.');
  state.pending={path,input:{requestId:crypto.randomUUID(),expectedVersion:state.status.version,...input}};persist();await continueRequest();
}
async function continueRequest(){
  if(!state.pending)return;
  const saved=state.pending;
  let response;
  try{response=await api(saved.path,saved.input);}
  catch(error){
    try{const retained=await api('operation?id='+encodeURIComponent(saved.input.requestId));state.lastOperation=retained.id;}
    catch(lookup){if(lookup.code==='TIMESCALE_OPERATION_NOT_FOUND'){state.pending=null;persist();}}
    throw error;
  }
  state.lastOperation=response.id;persist();
  notice.textContent='Operation saved. Its native outcome appears below.';await refresh();
}
function aggregate(){return state.edition?.catalog.find(x=>x.key===controls.aggregate.value);}
function renderAggregate(){
  const row=aggregate();optionsFor(controls['time-column'],row?.columns??[],x=>x.name+' · '+x.type,x=>x.name);
  projected.replaceChildren();
  for(const column of row?.columns??[]){
    const label=node('label'),input=node('input','',{type:'checkbox',value:column.name});input.checked=true;label.append(input,document.createTextNode(column.name));projected.append(label);
  }
  const time=row?.columns.find(x=>[20,21,23,1082,1114,1184].includes(Number(x.oid)));
  if(time){controls['time-column'].value=time.name;setTimeType();}
}
function setTimeType(){
  const column=aggregate()?.columns.find(x=>x.name===controls['time-column'].value);
  const types={20:'bigint',21:'smallint',23:'integer',1082:'date',1114:'timestamp without time zone',1184:'timestamp with time zone'};
  if(types[column?.oid])controls['time-type'].value=types[column.oid];
}
function windowInput(){
  if(!state.edition||!aggregate())throw new Error('Open an edition and select a continuous aggregate.');
  return {editionId:state.edition.value.id,editionDigest:state.edition.record.digest,aggregateKey:controls.aggregate.value,
    timeColumn:controls['time-column'].value,timeType:controls['time-type'].value,start:controls.start.value,end:controls.end.value,
    timezone:controls.timezone.value,title:controls.title.value,owner:controls.owner.value,note:controls.note.value};
}
async function loadEdition(id=controls.edition.value){
  if(!id)return;
  state.edition=await api('edition?id='+encodeURIComponent(id));const selected=state.edition;
  controls.edition.value=id;summary.textContent=selected.record.title+' · '+selected.catalog.length+' continuous aggregates · '+selected.record.created;
  optionsFor(controls.aggregate,selected.catalog,x=>x.schema+'.'+x.name,x=>x.key);
  optionsFor(controls.table,Object.keys(selected.value.tables),x=>x,x=>x);
  const jobs=selected.value.tables.jobs,rows=jobs.rows.map(values=>Object.fromEntries(jobs.columns.map((column,i)=>[column.name,values[i]])));
  optionsFor(controls['job-id'],rows,x=>x.job_id+' · '+(x.proc_name??x.application_name??''),x=>x.job_id);
  state.tableOffset=0;renderTable();renderAggregate();persist();
}
function table(columns,rows){
  const el=node('table'),thead=node('thead'),head=node('tr'),tbody=node('tbody');
  for(const name of columns)head.append(node('th',name));thead.append(head);el.append(thead,tbody);
  for(const row of rows){const tr=node('tr');for(const value of row)tr.append(node('td',value===null?'NULL':String(value)));tbody.append(tr);}return el;
}
function renderTable(){
  const captured=state.edition?.value.tables[controls.table.value];tableView.replaceChildren();if(!captured)return;
  const needle=controls.search.value.toLocaleLowerCase();
  const rows=needle?captured.rows.filter(row=>row.some(v=>v!==null&&v.toLocaleLowerCase().includes(needle))):captured.rows;
  tableView.append(table(captured.columns.map(x=>x.name),rows.slice(state.tableOffset,state.tableOffset+40)));
  tableCount.textContent=(rows.length?state.tableOffset+1:0)+'–'+Math.min(state.tableOffset+40,rows.length)+' of '+rows.length;
  controls['rows-prev'].disabled=state.tableOffset===0;controls['rows-next'].disabled=state.tableOffset+40>=rows.length;
}
async function loadPlan(id=controls.plan.value){if(!id)return;state.plan=await api('plan?id='+encodeURIComponent(id));controls.plan.value=id;planView.textContent=JSON.stringify(state.plan.data,null,2);persist();buttons();}
function planInput(){if(!state.plan)throw new Error('Open a saved plan first.');return {planId:state.plan.id,planDigest:state.plan.digest};}
async function showOperation(id){
  const row=await api('operation?id='+encodeURIComponent(id));output.textContent=JSON.stringify(row,null,2);
  if(!['RUNNING','DISPATCHING'].includes(row.state)&&state.pending?.input.requestId===id){
    state.pending=null;persist();const result=row.data.result;
    notice.textContent=row.state==='COMPLETE'?(result?.state?'Original extraction returned '+result.state+'.':'Operation complete.'):row.state.replaceAll('_',' ')+'. Its original input and outcome are retained below.';
    if(result?.editionId)await loadEdition(result.editionId);
    if(result?.planId&&result.plan)await loadPlan(result.planId);
    if(result?.publisherPlanId){await publisherHost.newPlan();await publisherHost.refresh();}
    if(result?.runId){await publisherHost.refresh();await publisherHost.openRun(result.runId);document.getElementById('candidate').scrollIntoView({block:'start'});}
  }
}
function renderHistory(){
  const rows=state.status.operations.rows,el=table(['Created','Kind','Outcome','Retained work'],rows.map(x=>[x.created,x.kind,x.state,'']));
  [...el.tBodies[0].rows].forEach((tr,i)=>{
    const selected=rows[i],open=node('button','Open',{type:'button'});open.onclick=()=>action(async()=>{state.lastOperation=selected.id;persist();await showOperation(selected.id);});tr.cells[3].append(open);
    if(selected.data.result?.native||selected.data.dispatch?.before)tr.cells[3].append(node('a','Download native result',{href:'/api/timescale/record?operation='+encodeURIComponent(selected.id)}));
  });
  history.replaceChildren(el);historyCount.textContent=state.offset+'–'+Math.min(state.offset+25,state.status.operations.total)+' of '+state.status.operations.total;
  controls['history-prev'].disabled=state.offset===0;controls['history-next'].disabled=state.offset+25>=Math.max(...['operations','editions','plans','reviews','events'].map(k=>state.status[k].total));
}
async function refresh(){
  if(state.polling)return;state.polling=true;
  try{
    state.status=await api('status?offset='+state.offset+'&limit=25');const data=state.status;
    context.textContent=data.title+' · '+(data.active?'Running '+data.active.kind:'Ready')+' · '+(data.maintenanceConfigured?'Maintenance connection configured':'Source observation connection');
    for(const id of ['edition','before','after'])optionsFor(controls[id],data.editions.rows,x=>x.title+' · '+x.created,x=>x.id);
    optionsFor(controls.plan,data.plans.rows,x=>x.data.title+' · '+x.kind,x=>x.id);
    if(state.edition)controls.edition.value=state.edition.value.id;if(state.plan)controls.plan.value=state.plan.id;
    renderHistory();if(state.lastOperation)await showOperation(state.lastOperation);
  }finally{state.polling=false;buttons();}
}
function downloadEdition(){
  if(!state.edition)return;
  const url=URL.createObjectURL(new Blob([JSON.stringify(state.edition.value,null,2)+'\n'],{type:'application/json'}));
  const link=node('a','',{download:state.edition.value.id+'.json',href:url});link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
capture.onsubmit=event=>{event.preventDefault();action(()=>send('capture',{title:controls['capture-title'].value,note:controls['capture-note'].value}));};
windowForm.onsubmit=event=>{event.preventDefault();action(async()=>{
  const selection=windowInput();
  if(event.submitter.value==='select')await send('select',{selection:{...selection,columns:[...projected.querySelectorAll('input:checked')].map(x=>x.value)}});
  else await send('refresh/prepare',{plan:{...selection,bucketsPerBatch:Number(controls.batch.value),maxBatches:Number(controls['max-batches'].value),newestFirst:controls.newest.checked,force:controls.force.checked}});
});};
job.onsubmit=event=>{event.preventDefault();action(async()=>{
  if(!state.edition)throw new Error('Open an edition first.');
  const changes=Object.fromEntries([...new FormData(job)].filter(([,value])=>value!==''));
  if(changes.scheduled!==undefined)changes.scheduled=changes.scheduled==='true';
  if(changes.max_retries!==undefined)changes.max_retries=Number(changes.max_retries);
  if(changes.config!==undefined)changes.config=JSON.parse(changes.config);
  await send('job/prepare',{editionId:state.edition.value.id,editionDigest:state.edition.record.digest,jobId:controls['job-id'].value,changes,
    title:controls.title.value,owner:controls.owner.value,note:controls.note.value});
});};
comparisonForm.onsubmit=event=>{event.preventDefault();action(async()=>{
  state.comparison=await api('compare?before='+encodeURIComponent(controls.before.value)+'&after='+encodeURIComponent(controls.after.value));
  comparisonSummary.textContent=state.comparison.changes.length+' changes. Assign a decision, owner and reason to every change.';decisions.replaceChildren();
  for(const change of state.comparison.changes){
    const field=node('fieldset');field.dataset.key=change.key;field.append(node('legend',change.kind+' · '+change.state),node('pre',JSON.stringify({identity:change.identity,fields:change.fields},null,2)));
    const decision=node('select');for(const value of ['ACCEPT','REMEDIATE','DEFER'])decision.append(node('option',value));
    const owner=node('input','',{name:'owner',placeholder:'Assigned owner',required:''});owner.value=controls.owner.value;
    const note=node('input','',{name:'note',placeholder:'Decision reason',required:''});field.append(decision,owner,note);decisions.append(field);
  }buttons();
});};
exportForm.onsubmit=event=>{event.preventDefault();action(()=>send('export',{outputDirectory:controls.output.value}));};
controls.aggregate.onchange=()=>{renderAggregate();persist();};controls['time-column'].onchange=setTimeType;
controls.table.onchange=controls.search.oninput=()=>{state.tableOffset=0;renderTable();};
panel.addEventListener('input',persist);panel.addEventListener('change',persist);
await action(async()=>{
  await refresh();state.storage='sf.timescale.'+state.status.id;
  let saved;try{saved=JSON.parse(sessionStorage.getItem(state.storage));}catch{}
  if(saved){
    state.pending=saved.pending;state.lastOperation=saved.lastOperation;
    if(saved.editionId)await loadEdition(saved.editionId);
    const aggregateId=saved.fields?.aggregate?.value;if(aggregateId){controls.aggregate.value=aggregateId;renderAggregate();}
    for(const[key,value]of Object.entries(saved.fields??{})){const control=controls[key];if(control){control.value=value.value;if(value.checked!==undefined)control.checked=value.checked;}}
    if(saved.planId)await loadPlan(saved.planId);
    if(state.pending)notice.textContent='Continue the saved request with its original identity.';
    await refresh();
  }
});
setInterval(()=>refresh().catch(error=>{notice.textContent=error.message;}),4000);
