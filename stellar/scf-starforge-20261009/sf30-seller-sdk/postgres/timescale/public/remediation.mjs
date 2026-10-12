// MIT. Continuing assigned work inside the original Timescale application.
import { timescaleHost } from '/timescale/app.mjs';

const root=document.createElement('section');root.id='timescale-remediation';root.className='ts-remediation';
const el=(tag,text='',attributes={})=>{const node=document.createElement(tag);node.textContent=text;for(const[k,v]of Object.entries(attributes))node.setAttribute(k,v);return node;};
const controls={};
function field(parent,id,label,{tag='input',...attributes}={}){
  const wrap=el('div','',{class:'ts-work-field'}),caption=el('label',label,{for:'ts-work-'+id});
  const input=el(tag,'',{id:'ts-work-'+id,...attributes});controls[id]=input;wrap.append(caption,input);parent.append(wrap);return input;
}
function choice(parent,id,label,values){
  const select=field(parent,id,label,{tag:'select'});
  for(const[value,text]of values)select.append(el('option',text,{value}));
  return select;
}
function button(parent,id,label,work){
  const node=el('button',label,{type:'button',id:'ts-work-'+id});controls[id]=node;
  if(work)node.onclick=()=>act(work);parent.append(node);return node;
}
function section(parent,title){const node=el('section');node.append(el('h4',title));parent.append(node);return node;}
function detail(parent,title){const node=el('details');node.append(el('summary',title));parent.append(node);return node;}
function table(headings,rows){
  const wrapper=el('div','',{class:'table-wrap'}),table=el('table'),thead=el('thead'),tr=el('tr'),tbody=el('tbody');
  for(const heading of headings)tr.append(el('th',heading));thead.append(tr);table.append(thead,tbody);
  for(const row of rows){const tr=el('tr');for(const value of row){const td=el('td');if(value instanceof Node)td.append(value);else td.textContent=value===null?'NULL':String(value??'');tr.append(td);}tbody.append(tr);}
  wrapper.append(table);return wrapper;
}
function selectRows(control,rows,label,value){
  const previous=control.value;control.replaceChildren(el('option','Select…',{value:''}));
  for(const row of rows)control.append(el('option',label(row),{value:value(row)}));
  if([...control.options].some(option=>option.value===previous))control.value=previous;
}
function sourceReference(source){return {reviewId:source.reviewId,comparisonDigest:source.comparisonDigest,changeKey:source.changeKey,digest:source.digest};}
const states=[['OPEN','Open'],['IN_PROGRESS','In progress'],['DEFERRED','Deferred']];
const state={workspaceId:null,version:null,busy:false,dirty:false,detail:null,context:null,list:null,sources:null,
  draft:null,draftRevision:null,createSource:null,pending:null,lastOutcome:null,offset:0,sourceOffset:0,contextOffset:0,timer:null,storage:null};
const header=el('div','',{class:'section-heading'});header.append(el('h3','Assigned remediation'));root.append(header);
button(header,'refresh','Refresh work',()=>refreshWork());
const statusLine=el('p','',{class:'muted'}),message=el('p','',{role:'status'});root.append(statusLine,message);
root.append(el('p','Work the original Remediate and Defer decisions through assigned plans, observed native outcomes and a recorded resolution. Native refresh, job and publication controls remain in this same application.',{class:'muted'}));
const filters=el('form','',{class:'ts-work-filters'});root.append(filters);
choice(filters,'filter-status','Work state',[['','All states'],...states,['RESOLVED','Resolved']]);
field(filters,'filter-owner','Assigned owner',{type:'search'});field(filters,'filter-q','Find work',{type:'search'});
const find=el('button','Find work',{type:'submit'});filters.append(find);
const workList=el('div');root.append(workList);
const nav=el('nav','',{class:'pagination'});root.append(nav);const pageLabel=el('span');
button(nav,'previous','Previous work',async()=>{state.offset=Math.max(0,state.offset-25);await loadList();});nav.append(pageLabel);
button(nav,'next','Next work',async()=>{state.offset+=25;await loadList();});
const recovery=section(root,'Original request recovery'),recoveryLabel=el('p');recovery.append(recoveryLabel);
button(recovery,'continue','Continue original request',()=>sendPending());
button(recovery,'inspect-request','Read original outcome',()=>inspectPending());
button(recovery,'download-request','Download retained request',async()=>{if(state.pending)download(state.pending.input.requestId+'.json',JSON.stringify(state.pending.input,null,2)+'\n','application/json');});
const sourcesPanel=detail(root,'Create work from an original review');
const sourceChooser=field(sourcesPanel,'source','Original assigned change',{tag:'select'});
button(sourcesPanel,'load-sources','Load reviewed assignments',()=>loadSources());
button(sourcesPanel,'create','Open assignment',()=>startCreate());
const sourceNav=el('nav','',{class:'pagination'});sourcesPanel.append(sourceNav);const sourcePageLabel=el('span');
button(sourceNav,'source-previous','Previous assignments',async()=>{state.sourceOffset=Math.max(0,state.sourceOffset-25);await loadSources();});sourceNav.append(sourcePageLabel);
button(sourceNav,'source-next','Next assignments',async()=>{state.sourceOffset+=25;await loadSources();});
const editor=section(root,'Work item'),identityLine=el('p','',{class:'muted'});editor.append(identityLine);
const workForm=el('form');editor.append(workForm);
const fieldsGrid=el('div','',{class:'ts-work-grid'});workForm.append(fieldsGrid);
field(fieldsGrid,'title','Work title',{required:'',maxlength:'128'});
field(fieldsGrid,'owner','Responsible owner',{required:'',maxlength:'128'});
field(fieldsGrid,'due','Due date',{type:'date'});
choice(fieldsGrid,'priority','Priority',[['NORMAL','Normal'],['HIGH','High'],['URGENT','Urgent']]);
choice(fieldsGrid,'status','Work state',states);
field(workForm,'intent','Intended work',{tag:'textarea',rows:'3',required:'',maxlength:'8000'});
field(workForm,'acceptance','Acceptance condition',{tag:'textarea',rows:'3',required:'',maxlength:'8000'});
const attributionGrid=el('div','',{class:'ts-work-grid'});workForm.append(attributionGrid);
field(attributionGrid,'actor','Recording operator',{required:'',maxlength:'128'});
field(attributionGrid,'note','Reason for this action',{tag:'textarea',rows:'2',required:'',maxlength:'8000'});
const save=el('button','Save assigned work',{type:'submit',id:'ts-work-save'});controls.save=save;workForm.append(save);
button(workForm,'discard-draft','Reload saved item',async()=>{if(state.detail)await openItem(state.detail.item.id);});
button(workForm,'reconcile-draft','Review saved revision against draft',()=>reconcileDraft());
const draftComparison=el('pre');workForm.append(draftComparison);
const originalSource=detail(editor,'Exact source and current assignment'),sourceView=el('pre');originalSource.append(sourceView);
const rebase=section(originalSource,'Use a later reviewed assignment');
field(rebase,'rebase','Later review of the same catalog item',{tag:'select'});
button(rebase,'rebase-save','Adopt reviewed assignment',async()=>{
  const source=state.sources?.sources.rows.find(row=>row.digest===controls.rebase.value);
  if(!source)throw new Error('Load and select the later original review.');
  await submit('rebase',{source:sourceReference(source)});
});
const linked=section(editor,'Original plans and native outcomes');
const contextNav=el('nav','',{class:'pagination'});linked.append(contextNav);const contextPageLabel=el('span');
button(contextNav,'context-previous','Previous retained records',async()=>{state.contextOffset=Math.max(0,state.contextOffset-25);await loadContext();});contextNav.append(contextPageLabel);
button(contextNav,'context-next','Next retained records',async()=>{state.contextOffset+=25;await loadContext();});
field(linked,'plan','Saved native or publication plan',{tag:'select'});
field(linked,'plan-relevance','How this plan addresses the assignment',{tag:'textarea',rows:'2',maxlength:'8000'});
button(linked,'bind-plan','Link original plan',async()=>{
  const plan=state.context?.plans.rows.find(row=>row.id===controls.plan.value);
  if(!plan)throw new Error('Select a retained plan.');
  await submit('bind-plan',{planId:plan.id,planDigest:plan.digest,relevance:controls['plan-relevance'].value});
});
button(linked,'open-plan','Open plan in native controls',async()=>{
  const id=controls.plan.value;if(!id)throw new Error('Select a saved plan first.');
  await timescaleHost.openPlan(id);
});
const planList=el('div');linked.append(planList);
field(linked,'operation','Actual operation for a linked plan',{tag:'select'});
field(linked,'operation-relevance','What this observed outcome establishes',{tag:'textarea',rows:'2',maxlength:'8000'});
button(linked,'observe','Retain actual outcome',async()=>{
  const operation=state.context?.operations.rows.find(row=>row.id===controls.operation.value);
  if(!operation)throw new Error('Choose an actual operation for a linked plan.');
  await submit('observe',{operationId:operation.id,operationDigest:operation.digest,relevance:controls['operation-relevance'].value});
});
button(linked,'open-operation','Open original operation',async()=>{
  if(!controls.operation.value)throw new Error('Select an original operation.');
  await timescaleHost.openOperation(controls.operation.value);
});
const observations=el('div');linked.append(observations);
const resolutionPanel=section(editor,'Later state and resolution');
field(resolutionPanel,'resolution-edition','Later retained native edition',{tag:'select'});
button(resolutionPanel,'compare-resolution','Read later source comparison',()=>loadContext(controls['resolution-edition'].value));
const comparisonView=el('pre');resolutionPanel.append(comparisonView);
choice(resolutionPanel,'resolution-mode','Resolution basis',[
  ['CURRENT_STATE_REVIEW','Assigned review of current catalog state'],
  ['COMPLETE_AGGREGATE_VERIFICATION','Exact completed aggregate verification']
]);
field(resolutionPanel,'verification','Complete verification for a linked plan',{tag:'select'});
choice(resolutionPanel,'resolution-outcome','Recorded assessment',[
  ['REMEDIATED','Remediated'],['ACCEPTED_CURRENT_STATE','Accepted current state'],['SUPERSEDED','Superseded']
]);
field(resolutionPanel,'resolution-statement','Resolution statement',{tag:'textarea',rows:'3',maxlength:'8000'});
button(resolutionPanel,'resolve','Record resolution',async()=>{
  const selected=state.context?.resolution;
  if(!selected||selected.editionId!==controls['resolution-edition'].value)throw new Error('Read the selected later edition comparison first.');
  const mode=controls['resolution-mode'].value;
  const resolution={editionId:selected.editionId,editionDigest:selected.editionDigest,
    comparisonDigest:selected.comparisonDigest,mode,outcome:controls['resolution-outcome'].value,
    statement:controls['resolution-statement'].value};
  if(mode==='COMPLETE_AGGREGATE_VERIFICATION'){
    const operation=state.context.operations.rows.find(row=>row.id===controls.verification.value);
    if(!operation)throw new Error('Select the exact completed verification.');
    resolution.verificationOperationId=operation.id;resolution.verificationOperationDigest=operation.digest;
  }
  await submit('resolve',{resolution});
});
button(resolutionPanel,'reopen','Reopen resolved work',()=>submit('reopen',{status:controls.status.value}));
const resolutionView=el('pre');resolutionPanel.append(resolutionView);
const history=section(editor,'History and receiving'),historyView=el('div');history.append(historyView);
const reportLinks=el('p');history.append(reportLinks);
history.append(el('p','Use Complete project handover below to export this entire original journal, all editions, plans, native records and the published dataset. Receiving and reopening that project restores this same assigned-work history.',{class:'muted'}));
document.querySelector('#timescale-workspace').insertBefore(root,document.querySelector('#ts-export').parentElement);

function canonical(value){
  if(Array.isArray(value))return value.map(canonical);
  if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])]));
  return value;
}
function semantic(value){const result=structuredClone(value);delete result.expectedVersion;return JSON.stringify(canonical(result));}
function draft(){
  const result={};for(const[id,control]of Object.entries(controls))if(['INPUT','TEXTAREA','SELECT'].includes(control.tagName))result[id]=control.value;
  return result;
}
function persist(strict=false){
  if(!state.storage)return;
  const value={schema:'sf.timescale.remediation-browser.v1',workspaceId:state.workspaceId,
    pending:state.pending,lastOutcome:state.lastOutcome,workItemId:state.detail?.item.id??null,
    itemRevision:state.draftRevision??state.detail?.item.revision??null,createSource:state.createSource,fields:draft(),dirty:state.dirty};
  try{sessionStorage.setItem(state.storage,JSON.stringify(value));}
  catch(error){if(strict)throw new Error('The browser could not retain the original request. Download its JSON and use the original CLI, or enable storage before dispatch.');}
}
function setPending(value){
  const previous=state.pending;state.pending=value;
  try{persist(true);}catch(error){state.pending=previous;throw error;}
}
function download(filename,text,type){
  const href=URL.createObjectURL(new Blob([text],{type})),link=el('a','',{href,download:filename});
  link.click();setTimeout(()=>URL.revokeObjectURL(href),1000);
}
async function api(path,input){
  let response,value;
  try{
    response=await fetch('/api/timescale/remediation/'+path,input===undefined?{}:{
      method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(input)});
    if(!/^application\/json(?:\s*;|$)/i.test(response.headers.get('content-type')??''))throw new Error('The original API returned an unreadable response.');
    value=await response.json();
  }catch(error){throw Object.assign(new Error(error.message||'The original response was interrupted.'),{outcomeUnknown:true});}
  if(!value||typeof value!=='object'||(typeof value.schema!=='string'||!value.schema.startsWith('stellar-forge.timescale-remediation-'))||
      state.workspaceId&&value.workspaceId!==state.workspaceId)
    throw Object.assign(new Error('The response did not identify this original Timescale workspace.'),{outcomeUnknown:true});
  if(!response.ok){
    const rejection=value.schema==='stellar-forge.timescale-remediation-error.v1'&&
      input&&value.requestId===input.requestId&&value.action===input.action&&value.workspaceId===state.workspaceId;
    throw Object.assign(new Error(value.message??'The original request did not complete.'),
      {code:value.error,status:response.status,rejection:Boolean(rejection),outcomeUnknown:!rejection});
  }
  return value;
}
function availability(){
  const selected=Boolean(state.detail),resolved=state.detail?.item.status==='RESOLVED';
  const blocked=state.busy||Boolean(state.pending),nativeBusy=timescaleHost.hasPending();
  for(const control of root.querySelectorAll('button,input,textarea,select'))control.disabled=state.busy;
  for(const name of ['save','rebase-save','bind-plan','observe','resolve'])controls[name].disabled=blocked||nativeBusy||resolved||(!selected&&!state.createSource);
  for(const name of ['rebase-save','bind-plan','observe','resolve'])controls[name].disabled||=!selected;
  controls.reopen.disabled=blocked||nativeBusy||!resolved;
  controls['continue'].disabled=state.busy||!state.pending;
  controls['inspect-request'].disabled=state.busy||(!state.pending&&!state.lastOutcome);
  controls['download-request'].disabled=state.busy||!state.pending;
  controls['previous'].disabled=state.busy||state.offset===0;
  controls.next.disabled=state.busy||state.list?.items.next==null;
  controls['source-previous'].disabled=state.busy||state.sourceOffset===0;
  controls['source-next'].disabled=state.busy||state.sources?.sources.next==null;
  controls['context-previous'].disabled=state.busy||state.contextOffset===0;
  controls['context-next'].disabled=state.busy||!state.context||['plans','operations','editions'].every(name=>state.context[name].next==null);
  controls['open-plan'].disabled=state.busy||!controls.plan.value;
  controls['open-operation'].disabled=state.busy||!controls.operation.value;
  controls['compare-resolution'].disabled=state.busy||!selected||!controls['resolution-edition'].value;
  controls['discard-draft'].disabled=state.busy||!selected;
  controls['reconcile-draft'].disabled=blocked||!selected||!state.dirty;
  if(resolved)for(const name of ['title','owner','due','priority','intent','acceptance'])controls[name].disabled=true;
  recoveryLabel.textContent=state.pending?'Original '+state.pending.input.action+' request '+state.pending.input.requestId+
    ' is retained. Continue or read that same request; the browser does not invent another identity.':
    state.lastOutcome?'Last retained operation: '+state.lastOutcome:'No unresolved work request in this browser.';
}
async function act(work){
  if(state.busy)return;state.busy=true;availability();
  try{await work();}catch(error){message.textContent=error.message+(error.outcomeUnknown?' The original request is retained.':'');}
  finally{state.busy=false;availability();}
}
function canReplace(){
  if(state.pending)throw new Error('Read or continue the retained original request before replacing the editor.');
  return !state.dirty||window.confirm('Replace the unsaved work-item edits with the selected saved state?');
}
async function loadList(){
  const query=new URLSearchParams({offset:String(state.offset),limit:'25'});
  for(const [field,key]of [['filter-status','status'],['filter-owner','owner'],['filter-q','q']])if(controls[field].value)query.set(key,controls[field].value);
  const value=await api('list?'+query);if(!state.workspaceId){state.workspaceId=value.workspaceId;state.storage='sf.timescale.remediation.'+value.workspaceId;}
  state.list=value;state.version=value.version;
  statusLine.textContent=Object.entries(value.counts).map(([name,count])=>name.replaceAll('_',' ')+' '+count).join(' · ');
  workList.replaceChildren(table(['Work','State','Owner','Due','Priority','Source',''],value.items.rows.map(row=>{
    const open=el('button','Open',{type:'button'});open.onclick=()=>act(()=>openItem(row.id));
    return [row.title,row.status.replaceAll('_',' '),row.owner,row.dueDate||'Unscheduled',row.priority,row.source.kind,open];
  })));
  if(!value.items.rows.length)workList.append(el('p','No assigned work matches this view.'));
  pageLabel.textContent=(value.items.total?value.items.offset+1:0)+'–'+Math.min(value.items.offset+value.items.limit,value.items.total)+' of '+value.items.total;
  availability();
}
async function loadSources(){
  const value=await api('sources?offset='+state.sourceOffset+'&limit=25');state.sources=value;
  selectRows(sourceChooser,value.sources.rows,row=>row.kind+' · '+row.decision+' · '+row.assignedOwner+
    (row.workItemId?' · already assigned':''),row=>row.digest);
  const selected=state.detail?.item;
  selectRows(controls.rebase,value.sources.rows.filter(row=>selected&&row.kind===selected.source.kind&&
    row.identity===selected.source.identity&&row.digest!==selected.source.digest&&!row.workItemId),
    row=>row.decision+' · '+row.reviewedAt+' · '+row.assignedOwner,row=>row.digest);
  sourcePageLabel.textContent=(value.sources.total?value.sources.offset+1:0)+'–'+Math.min(value.sources.offset+25,value.sources.total)+' of '+value.sources.total;
  availability();
}
function showFields(value){
  for(const key of ['title','owner','priority','status','intent','acceptance'])controls[key].value=key==='status'&&value[key]==='RESOLVED'?'IN_PROGRESS':value[key]??'';
  controls.due.value=value.dueDate??'';
}
function renderDetail(){
  const value=state.detail?.item;
  identityLine.textContent=value?value.id+' · Revision '+value.revision+' · '+state.detail.digest:
    state.createSource?'New work for the selected original assignment':'Open an assigned item or a reviewed change.';
  sourceView.textContent=JSON.stringify(value?.source??state.createSource??{},null,2);
  planList.replaceChildren(table(['Plan','Kind','Assignment','Relevance'],(value?.plans??[]).map(row=>
    [row.title,row.kind,row.sourceDigest===value.source.digest?'Current':'Earlier source',row.relevance])));
  observations.replaceChildren(table(['Observed','Operation','State','Returned result','Assessment'],(value?.observations??[]).map(row=>
    [row.at,row.operation.kind+' · '+row.operation.id,row.operation.state,
      row.operation.data.result?.matches===true?'Complete aggregate matched':
      row.operation.data.result?.matches===false?'Aggregate differed':row.operation.data.result?.state??'No coverage assertion',row.relevance])));
  resolutionView.textContent=value?.resolution?JSON.stringify(value.resolution,null,2):'No current resolution is recorded.';
  historyView.replaceChildren(table(['Revision','Time','Operator','Action','Reason'],(state.detail?.history??[]).map(row=>
    [row.revision,row.at,row.actor,row.action,row.note])));
  reportLinks.replaceChildren();
  if(value)for(const[format,label]of [['html','Download readable work report'],['json','Download exact work revision and history']])
    reportLinks.append(el('a',label,{href:'/api/timescale/remediation/report?id='+encodeURIComponent(value.id)+'&format='+format}),document.createTextNode(' '));
  save.textContent=state.createSource?'Create assigned work':'Save assigned work';
}
async function startCreate(){
  const source=state.sources?.sources.rows.find(row=>row.digest===sourceChooser.value);
  if(!source)throw new Error('Load and choose an original Remediate or Defer decision.');
  if(source.workItemId){await openItem(source.workItemId);return;}
  if(!canReplace())return;
  state.detail=null;state.context=null;state.createSource=source;state.draftRevision=null;state.dirty=false;draftComparison.textContent='';
  showFields({title:source.kind+' remediation',owner:source.assignedOwner,dueDate:'',priority:'NORMAL',
    status:source.decision==='DEFER'?'DEFERRED':'OPEN',intent:source.decisionNote,acceptance:''});
  controls.note.value='';renderDetail();persist();editor.scrollIntoView({block:'start'});availability();
}
async function openItem(id,{force=false}={}){
  if(!force&&!canReplace())return;
  const value=await api('item?id='+encodeURIComponent(id));state.detail=value;state.createSource=null;state.draftRevision=value.item.revision;state.dirty=false;draftComparison.textContent='';
  state.contextOffset=0;showFields(value.item);controls.note.value='';state.version=value.version;
  renderDetail();await loadContext();persist();editor.scrollIntoView({block:'start'});
}
async function loadContext(editionId=state.context?.resolution?.editionId){
  if(!state.detail)return;
  const query=new URLSearchParams({id:state.detail.item.id,offset:String(state.contextOffset),limit:'25'});
  if(editionId)query.set('editionId',editionId);
  const value=await api('context?'+query);
  if(value.itemRevision!==state.detail.item.revision||value.sourceDigest!==state.detail.item.source.digest)
    throw new Error('The saved item changed. Reload its current revision; your editor draft is retained.');
  state.context=value;
  selectRows(controls.plan,value.plans.rows,row=>row.title+' · '+row.kind,row=>row.id);
  selectRows(controls.operation,value.operations.rows,row=>row.kind+' · '+row.state+' · '+row.updated,row=>row.id);
  selectRows(controls.verification,value.operations.rows.filter(row=>row.kind==='verification'&&row.state==='COMPLETE'&&row.data.result?.matches===true),
    row=>row.id+' · '+row.updated,row=>row.id);
  selectRows(controls['resolution-edition'],value.editions.rows,row=>row.title+' · '+row.created,row=>row.id);
  if(editionId&&[...controls['resolution-edition'].options].some(row=>row.value===editionId))controls['resolution-edition'].value=editionId;
  contextPageLabel.textContent='Offset '+state.contextOffset+' · '+value.plans.total+' plans · '+value.operations.total+' linked operations · '+value.editions.total+' editions';
  comparisonView.textContent=value.resolution?JSON.stringify(value.resolution,null,2):'Choose a later edition and read its original comparison.';
  availability();
}
async function reconcileDraft(){
  if(!state.detail||!state.dirty)return;
  const current=await api('item?id='+encodeURIComponent(state.detail.item.id));
  const proposed=Object.fromEntries(['title','owner','priority','status','intent','acceptance'].map(key=>[key,controls[key].value]));
  proposed.dueDate=controls.due.value;
  draftComparison.textContent=JSON.stringify({savedRevision:current.item.revision,savedFields:Object.fromEntries(
    ['title','owner','dueDate','priority','status','intent','acceptance'].map(key=>[key,current.item[key]])),proposedFields:proposed},null,2);
  draftComparison.scrollIntoView({block:'center'});
  if(current.item.status==='RESOLVED')throw new Error('The current saved item is resolved. Keep this draft separately, then reload and explicitly reopen that resolution.');
  if(!window.confirm('The current saved fields and your draft are shown together. Keep your edited fields against this displayed current revision?'))return;
  state.detail=current;state.draftRevision=current.item.revision;state.version=current.version;renderDetail();await loadContext();persist();
  message.textContent='Your fields are retained against the explicitly reviewed saved revision '+current.item.revision+'. Save to record the change.';
}
async function refreshWork(){
  await timescaleHost.refresh();await loadList();
  if(state.detail&&!state.dirty&&!state.pending)await openItem(state.detail.item.id,{force:true});
  else if(state.dirty)message.textContent='The work list is current. Your unsaved item fields remain in the editor.';
  if(state.pending)await inspectPending();
}
function attribution(){
  if(!controls.actor.value.trim()||!controls.note.value.trim())throw new Error('Enter the recording operator and the reason for this action.');
  return {actor:controls.actor.value,note:controls.note.value};
}
async function submit(action,payload){
  if(state.pending)throw new Error('Continue the original retained request before starting another work command.');
  if(timescaleHost.hasPending())throw new Error('Finish or inspect the original native operation request in the controls above first.');
  if(action!=='create'&&!state.detail)throw new Error('Open a saved work item.');
  if(!['create','edit'].includes(action)&&state.dirty)throw new Error('Save the item fields before recording another action; your current draft is retained.');
  if(action==='edit'&&state.draftRevision!==state.detail.item.revision)throw new Error('The retained draft began on another revision. Review saved revision against draft or reload it before saving.');
  const current=await api('list?limit=1');
  const input={requestId:crypto.randomUUID(),expectedVersion:current.version,action,...attribution(),
    ...(action==='create'?{}:{workItemId:state.detail.item.id,expectedRevision:state.detail.item.revision}),...payload};
  setPending({input});await sendPending();
}
function checkOperation(value,input){
  const row=value.operation;
  if(value.schema!=='stellar-forge.timescale-remediation-operation.v1'||row?.id!==input.requestId||
      row.kind!=='remediation'||semantic(row.input)!==semantic(input))
    throw Object.assign(new Error('The returned operation does not match the exact retained request.'),{outcomeUnknown:true});
  return row;
}
async function showOutcome(row){
  state.lastOutcome=row.id;
  if(row.state==='COMPLETE'){
    const result=row.data.result;
    if(result?.schema!=='stellar-forge.timescale-remediation-receipt.v1'||result.workspaceId!==state.workspaceId||
        result.requestId!==row.id||result.workItemId!==result.item?.id||result.itemRevision!==result.item.revision)
      throw Object.assign(new Error('The completed receipt did not identify this exact item revision.'),{outcomeUnknown:true});
    setPending(null);state.dirty=false;await loadList();await openItem(result.workItemId,{force:true});
    message.textContent='Saved '+result.action+' · revision '+result.itemRevision+'. The original request and full item history are retained.';
  }else if(row.state==='FAILED'){
    setPending(null);message.textContent='The original request returned '+(row.data.error?.code??'FAILED')+
      '. Its failed input remains in Operations. Your current draft is retained; correct it before creating another request.';
  }else if(row.state==='RUNNING'||row.state==='DISPATCHING'){
    message.textContent='Original request '+row.id+' is '+row.state.toLowerCase()+'.';
    scheduleRead();
  }else{
    message.textContent='Original request '+row.id+' is '+row.state+'. Continue that same saved request after reviewing its original outcome.';
  }
  persist();availability();
}
function scheduleRead(){
  clearTimeout(state.timer);
  state.timer=setTimeout(()=>{if(state.busy)scheduleRead();else act(()=>inspectPending());},1500);
}
async function inspectPending(){
  const id=state.pending?.input.requestId??state.lastOutcome;
  if(!id)return;
  const value=await api('operation?id='+encodeURIComponent(id));
  if(state.pending)await showOutcome(checkOperation(value,state.pending.input));
  else{
    const row=value.operation;
    if(row?.id!==id||row.kind!=='remediation')throw new Error('The original retained operation did not match.');
    message.textContent='Original '+row.kind+' request '+id+' · '+row.state+'.';
  }
}
async function sendPending(){
  if(!state.pending)return;
  const original=state.pending,input=original.input;
  let value;
  try{value=await api('command',input);}
  catch(error){
    const rejectedBeforeStart=new Set(['TIMESCALE_INPUT_INVALID','TIMESCALE_REQUEST_ID_REQUIRED','TIMESCALE_REVISION_CHANGED','TIMESCALE_WORKSPACE_BUSY','TIMESCALE_WORKSPACE_CLOSED','TIMESCALE_REMEDIATION_ACTION_INVALID','TIMESCALE_REMEDIATION_INTEGER_REQUIRED','TIMESCALE_TEXT_REQUIRED']);
    if(error.rejection&&[400,409].includes(error.status)&&rejectedBeforeStart.has(error.code)){
      setPending(null);message.textContent=error.message+' The original API rejected this request before dispatch; the item draft is retained.';
    }else message.textContent=error.message+' Keep the original request and inspect or continue it.';
    throw error;
  }
  if(value.schema!=='stellar-forge.timescale-remediation-ack.v1'||value.requestId!==input.requestId||
      value.id!==input.requestId||value.action!==input.action)
    throw Object.assign(new Error('The acknowledgement did not match the original request.'),{outcomeUnknown:true});
  await inspectPending();
}
workForm.onsubmit=event=>{event.preventDefault();act(async()=>{
  const fields={title:controls.title.value,owner:controls.owner.value,dueDate:controls.due.value,priority:controls.priority.value,
    status:controls.status.value,intent:controls.intent.value,acceptance:controls.acceptance.value};
  if(state.createSource)await submit('create',{source:sourceReference(state.createSource),fields});
  else await submit('edit',{fields});
});};
filters.onsubmit=event=>{event.preventDefault();act(async()=>{state.offset=0;await loadList();});};
for(const name of ['title','owner','due','priority','status','intent','acceptance'])
  controls[name].addEventListener('input',()=>{if(state.detail?.item.status!=='RESOLVED'){state.dirty=true;persist();}});
root.addEventListener('input',()=>persist());root.addEventListener('change',()=>{persist();availability();});
window.addEventListener('beforeunload',event=>{if(state.dirty||state.pending){event.preventDefault();event.returnValue='';}});
window.addEventListener('pagehide',()=>clearTimeout(state.timer));
await act(async()=>{
  await loadList();
  let saved;try{saved=JSON.parse(sessionStorage.getItem(state.storage));}catch{}
  if(saved?.schema==='sf.timescale.remediation-browser.v1'&&saved.workspaceId===state.workspaceId){
    state.pending=saved.pending??null;state.lastOutcome=saved.lastOutcome??null;
    if(saved.workItemId){
      await openItem(saved.workItemId,{force:true});
      if(saved.dirty&&saved.itemRevision!==state.detail.item.revision)
        message.textContent='A later saved revision exists. Your prior draft remains visible; reload or reconcile it explicitly before saving.';
    }else if(saved.createSource){state.createSource=saved.createSource;renderDetail();}
    if(saved.dirty||saved.createSource){
      state.draftRevision=saved.itemRevision;
      for(const[key,value]of Object.entries(saved.fields??{}))if(controls[key]&&typeof value==='string')controls[key].value=value;
      state.dirty=Boolean(saved.dirty);
    }else for(const key of ['actor','filter-owner','filter-status','filter-q'])
      if(typeof saved.fields?.[key]==='string')controls[key].value=saved.fields[key];
    if(saved.pending)state.pending=saved.pending;
    persist();
    if(state.pending)await inspectPending();
  }
  renderDetail();availability();
});
