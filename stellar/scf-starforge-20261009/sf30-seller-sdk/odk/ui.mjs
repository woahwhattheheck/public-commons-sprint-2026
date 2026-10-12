// MIT. Original Central operator. All provider text is rendered as text nodes.
const $=id=>document.getElementById(id),uuid=()=>crypto.randomUUID();
const storageKey='central-field-data:'+location.origin;
let token='',workspace=null,edition=null,outputEdition=null,selectedConnection='',selectedForms=[],projectForms=[],
  rowCursor=null,resourceCursor=null,indicators=[],pollTimer=null,refreshing=null,tableRequest=0,resourceRequest=0;
const pending=new Map();
function readStorage(key){try{return sessionStorage.getItem(storageKey+':'+key);}catch{return null;}}
function writeStorage(key,value){try{sessionStorage.setItem(storageKey+':'+key,value);}catch{/* The open operator retains its current requests in memory. */}}
function notice(message,error=false){$('notice').textContent=String(message);$('notice').classList.toggle('error',error);}
function showError(error){notice((error.code?error.code+': ':'')+error.message+(error.operationId?'\nOperation '+error.operationId:''),true);}
function node(tag,text,classes){const result=document.createElement(tag);if(text!==undefined&&text!==null)result.textContent=String(text);if(classes)result.className=classes;return result;}
function replace(id,...children){$(id).replaceChildren(...children.filter(Boolean));}
function empty(message){return node('div',message,'empty');}
function pretty(value){return JSON.stringify(value,null,2);}
function date(value){return value?String(value).replace('T',' ').replace(/\.\d+Z$/,' UTC').replace(/Z$/,' UTC'):'—';}
function bytes(value){if(!Number.isFinite(value))return '—';if(value<1024)return value+' B';if(value<1048576)return (value/1024).toFixed(1)+' KiB';if(value<1073741824)return (value/1048576).toFixed(1)+' MiB';return (value/1073741824).toFixed(2)+' GiB';}
function short(value,max=140){const text=value===null?'null':value===undefined?'missing':typeof value==='object'?JSON.stringify(value):String(value);return text.length>max?text.slice(0,max)+'…':text;}
function cellValue(row,path){let current=row;for(const part of path.split('/')){if(current===null)return {state:'null',value:null};if(typeof current!=='object'||!Object.hasOwn(current,part))return {state:'missing'};current=current[part];}return {state:current===null?'null':'value',value:current};}
function button(label,action,disabled=false){const result=node('button',label);result.type='button';result.disabled=disabled;result.addEventListener('click',event=>busy(event.currentTarget,action));return result;}
async function busy(control,action){const wasDisabled=control.disabled;control.disabled=true;try{return await action();}catch(error){showError(error);}finally{control.disabled=wasDisabled;syncControls();}}
function syncControls(){ $('next-rows').disabled=!rowCursor;$('next-resources').disabled=!resourceCursor;
  if(edition){$('resume-capture').disabled=edition.status==='COMPLETE'||edition.status==='CAPTURING';$('pause-capture').disabled=edition.status!=='CAPTURING';$('use-for-report').disabled=edition.status!=='COMPLETE';$('review-form').querySelector('button').disabled=edition.status!=='COMPLETE';}}
function bind(id,action){$(id).addEventListener('click',event=>busy(event.currentTarget,action));}
function form(id,action){$(id).addEventListener('submit',event=>{event.preventDefault();const submit=event.submitter||event.currentTarget.querySelector('button');busy(submit,()=>action(new FormData(event.currentTarget),event.currentTarget));});}
function table(headers,rows){const result=node('table'),head=node('thead'),hr=node('tr'),body=node('tbody');for(const text of headers)hr.append(node('th',text));head.append(hr);for(const row of rows){const tr=node('tr');for(const value of row){const td=node('td');td.append(value instanceof Node?value:node('span',value??'—'));tr.append(td);}body.append(tr);}result.append(head,body);return result;}
function options(id,items,{blank=null,label=value=>value.name||value.label||value.id,value=item=>item.id}={}){const select=$(id),old=select.value;select.replaceChildren();if(blank!==null){const option=node('option',blank);option.value='';select.append(option);}for(const item of items){const option=node('option',label(item));option.value=String(value(item));select.append(option);}if([...select.options].some(option=>option.value===old))select.value=old;}
function chosen(id,label){const value=$(id).value;if(!value)throw new Error('Choose '+label+'.');return value;}
function fieldsFor(capture,tableId,{scalar=false}={}){const selected=capture?.tables.find(item=>item.id===tableId);if(!selected)return [];const form=capture.forms.find(item=>item.key===selected.formKey);return selected.query.fields.filter(field=>!scalar||!field.collection&&!form.catalog.complexTypes[field.type]);}
function tableLabel(capture,item){return (capture.forms.find(value=>value.key===item.formKey)?.name||'Form')+' / '+item.name;}
function tableOptions(id,capture){options(id,capture.tables,{label:item=>tableLabel(capture,item)});}
function pane(name){for(const item of document.querySelectorAll('.pane'))item.hidden=item.id!==name||!workspace;for(const item of document.querySelectorAll('nav [data-pane]'))item.classList.toggle('selected',item.dataset.pane===name);writeStorage('pane',name);}
document.addEventListener('click',event=>{const target=event.target.closest('[data-pane]');if(target)pane(target.dataset.pane);});
function detail(title,...content){$('detail-title').textContent=title;replace('detail-content',...content);if(!$('detail-dialog').open)$('detail-dialog').showModal();}
bind('close-detail',()=>$('detail-dialog').close());
async function request(path,{method='GET',body}={}){
  let response;
  try{response=await fetch(path,{method,headers:{Authorization:'Bearer '+token,...(body===undefined?{}:{'Content-Type':'application/json'})},
    ...(body===undefined?{}:{body:JSON.stringify(body)}),cache:'no-store',credentials:'omit'});}
  catch(cause){const error=new Error('The host response was lost. Reopen the retained operation before retrying.');error.code='CENTRAL_CONNECTION_LOST';error.uncertain=true;error.cause=cause;throw error;}
  let value;try{value=await response.json();}catch{const error=new Error('The host returned an unreadable response. Reopen the retained operation.');error.code='CENTRAL_RESPONSE';error.uncertain=true;throw error;}
  if(!response.ok||value.ok===false){const original=value.error??value,error=new Error(original.message||response.statusText);Object.assign(error,original,{status:response.status});
    if(response.status===401){workspace=null;$('unlock').hidden=false;for(const section of document.querySelectorAll('.pane'))section.hidden=true;}
    throw error;}
  return value;
}
async function action(method,input={}){const envelope=await request('/api/actions/'+method,{method:'POST',body:input});return envelope.result;}
function persistPending(){writeStorage('pending',JSON.stringify([...pending.values()]));renderPending();}
function pendingCollection(method){return {connect:'connections',createPlan:'plans',capture:'captures',report:'reports',exportDataset:'exports',backup:'archives'}[method];}
async function retainedAction(method,input){
  const id=input.reportId??input.exportId??input.id;
  if(!id)throw new Error('Retain this operation ID before starting.');
  const operation=pending.get(id)||{id,method,input,startedAt:new Date().toISOString(),status:'Sending'};
  pending.set(id,operation);persistPending();
  try{const result=await action(method,input);pending.delete(id);persistPending();return result;}
  catch(error){operation.status=error.uncertain?'Response unresolved':'Review the operation response';operation.error={code:error.code,message:error.message};persistPending();error.operationId=id;throw error;}
}
function reconcilePending(){if(!workspace)return;let changed=false;for(const [id,operation]of pending){const collection=pendingCollection(operation.method);if(collection&&workspace[collection]?.some(item=>item.id===id)){pending.delete(id);changed=true;}}if(changed)persistPending();}
function renderPending(){const content=[];for(const operation of pending.values()){const item=node('div',null,'operation');item.append(node('strong',operation.method+' · '+operation.status),node('p','Operation '+operation.id+' · '+date(operation.startedAt)),node('p',operation.error?.message||'The same request remains available until its result is received.'));
    item.append(button('Read workspace result',()=>refresh()),button('Retry original request',async()=>{await retainedAction(operation.method,operation.input);await refresh();notice('Original operation received.');}),button('View original input',()=>detail('Retained operation',node('pre',pretty(operation)))));
    content.push(item);}replace('pending-operations',...content);
}
function descending(items){return [...items].sort((a,b)=>String(b.createdAt||b.startedAt).localeCompare(String(a.createdAt||a.startedAt)));}
function captureList(items){if(!items.length)return empty('Create a capture plan to receive your first reporting edition.');return table(['Edition','Status','Rows / history','Source progress','Open'],descending(items).map(item=>[
  node('span',item.label),node('span',item.status,'tag'),(item.rowCount??0)+' rows · '+(item.submissionCount??0)+' submission histories',
  item.error?item.error.message:[item.progress?.stage,item.progress?.form].filter(Boolean).join(' · '),
  button('Open edition',()=>openEdition(item.id))
]));}
function renderState(){
  $('identity').textContent='Workspace '+workspace.id+' · revision '+workspace.revision;
  replace('metrics',...[[workspace.connections.length,'Central connections'],[workspace.captures.filter(item=>item.status==='COMPLETE').length,'Complete reporting editions'],
    [workspace.running.length,'Captures in progress'],[workspace.reports.length+workspace.exports.length,'Reports and datasets']].map(([value,label])=>{const item=node('div',null,'metric');item.append(node('strong',value),node('span',label));return item;}));
  replace('recent-captures',captureList(workspace.captures.slice(-12)));
  options('source-connection',workspace.connections);options('plan-connection',workspace.connections);
  if(!selectedConnection)selectedConnection=$('plan-connection').value;
  replace('connection-list',workspace.connections.length?table(['Connection','Central server','Verified user','Verified at'],workspace.connections.map(item=>[
    item.name,item.url,item.actor?.displayName||item.actor?.email||item.actor?.id||'Authorized user',date(item.verifiedAt)])):empty('Add the existing Central server and its host credential reference.'));
  options('edition-select',descending(workspace.captures),{label:item=>item.label+' · '+item.status});
  const complete=descending(workspace.captures.filter(item=>item.status==='COMPLETE'));
  options('output-edition',complete,{label:item=>item.label});renderBaselineOptions();
  renderPlans();renderOutputs();renderWorkspace();renderPending();
}
function renderBaselineOptions(){const selected=workspace?.captures.find(item=>item.id===$('output-edition').value),connection=workspace?.connections.find(item=>item.id===selected?.connectionId);
  const candidates=(workspace?.captures??[]).filter(item=>item.status==='COMPLETE'&&item.id!==selected?.id&&workspace.connections.find(value=>value.id===item.connectionId)?.url===connection?.url);
  options('baseline-select',descending(candidates),{blank:'No previous period',label:item=>item.label});}
function schedulePoll(){clearTimeout(pollTimer);if(document.visibilityState==='visible'&&workspace?.running.length)pollTimer=setTimeout(async()=>{
  try{await refresh({quiet:true});if(edition&&workspace.captures.find(item=>item.id===edition.id)?.revision!==edition.revision){const value=await action('edition',{id:edition.id});if(edition?.id===value.id){edition=value;renderEditionSummary();}}}catch(error){showError(error);}finally{schedulePoll();}
},3000);}
async function refresh({quiet=false}={}){if(refreshing)return refreshing;refreshing=(async()=>{workspace=await request('/api/state');$('unlock').hidden=true;
  reconcilePending();renderState();pane(readStorage('pane')||'overview');if(!quiet)notice('Workspace current · '+date(new Date().toISOString()));schedulePoll();return workspace;
})();try{return await refreshing;}finally{refreshing=null;}}
document.addEventListener('visibilitychange',schedulePoll);
bind('refresh',()=>refresh());
form('unlock-form',async()=>{token=$('operator-token').value.trim();writeStorage('token',token);await refresh();$('operator-token').value='';});
form('connection-form',async data=>{const result=await retainedAction('connect',{id:uuid(),name:data.get('name'),url:data.get('url'),
  authEnv:data.get('authEnv'),allowLoopback:data.has('allowLoopback')});await refresh();$('source-connection').value=result.id;$('plan-connection').value=result.id;selectedConnection=result.id;selectedForms=[];renderSelectedForms();$('new-connection').open=false;notice('Central connection verified. Load its projects to choose forms.');});
bind('load-projects',async()=>{const connectionId=chosen('source-connection','a Central connection'),result=await action('projects',{connectionId});
  options('source-project',result.projects,{label:item=>item.name||String(item.id)});projectForms=[];replace('source-forms',empty(result.projects.length?'Choose a project and load its forms.':'This Central user has no accessible projects.'));notice(result.projects.length+' projects received.');});
$('source-connection').addEventListener('change',()=>{$('source-project').replaceChildren();projectForms=[];replace('source-forms',empty('Load projects from this connection.'));});
bind('load-forms',async()=>{const connectionId=chosen('source-connection','a Central connection'),projectId=chosen('source-project','a project'),result=await action('forms',{connectionId,projectId});projectForms=result.forms;
  const rows=projectForms.map(item=>{const check=document.createElement('input');check.type='checkbox';check.value=item.xmlFormId;check.dataset.formName=item.name||item.xmlFormId;check.setAttribute('aria-label','Select '+(item.name||item.xmlFormId));check.checked=selectedConnection===connectionId&&selectedForms.some(selected=>selected.projectId===projectId&&selected.formId===item.xmlFormId);
    return [check,item.name||item.xmlFormId,item.xmlFormId,item.version??'',item.state??'',item.submissions??'—'];});
  replace('source-forms',rows.length?table(['Select','Form','Original form ID','Published version','State','Submissions'],rows):empty('This project has no accessible forms.'));
  notice(result.forms.length+' source forms received.');});
bind('select-forms',()=>{const connectionId=chosen('source-connection','a Central connection'),projectId=chosen('source-project','a project'),checks=[...$('source-forms').querySelectorAll('input[type=checkbox]:checked')];
  if(!checks.length)throw new Error('Select at least one published source form.');
  if(selectedConnection&&selectedConnection!==connectionId&&selectedForms.length)throw new Error('The current plan uses another connection. Remove its selected forms before choosing a different source.');
  selectedConnection=connectionId;$('plan-connection').value=connectionId;
  for(const check of checks)if(!selectedForms.some(item=>item.projectId===projectId&&item.formId===check.value))selectedForms.push({projectId,formId:check.value,name:check.dataset.formName});
  renderSelectedForms();pane('plans');notice('Forms selected. Set the reporting period and save this plan.');});
function renderSelectedForms(){replace('selected-forms',...(selectedForms.length?selectedForms.map((item,index)=>{const line=node('div',null,'selection-row');line.append(node('span',item.name+' · project '+item.projectId+' · '+item.formId),button('Remove',()=>{selectedForms.splice(index,1);renderSelectedForms();}));return line;}):[empty('Choose existing source forms from a Central project.')]));}
$('plan-connection').addEventListener('change',()=>{if(selectedForms.length&&$('plan-connection').value!==selectedConnection){$('plan-connection').value=selectedConnection;notice('Remove the selected forms before changing their connection.',true);}else selectedConnection=$('plan-connection').value;});
function utc(value){return value?new Date(String(value)+'Z').toISOString():undefined;}
function localUtc(value){return value?String(value).slice(0,16):'';}
form('plan-form',async data=>{if(!selectedForms.length)throw new Error('Choose the source forms for this reporting cohort.');const scope={pageSize:Number(data.get('pageSize'))};
  for(const name of ['submittedFrom','submittedBefore','updatedSince'])if(data.get(name))scope[name]=utc(data.get(name));
  await retainedAction('createPlan',{id:uuid(),name:data.get('name'),connectionId:chosen('plan-connection','a connection'),forms:selectedForms.map(({projectId,formId})=>({projectId,formId})),scope});
  await refresh();notice('Capture plan saved. Start its reporting edition below.');});
function renderPlans(){replace('plan-list',workspace.plans.length?table(['Plan','Forms','Submitted window · UTC','Actions'],descending(workspace.plans).map(item=>{
  const actions=node('div',null,'file-list');actions.append(button('Capture this period',async()=>{const result=await retainedAction('capture',{id:uuid(),planId:item.id});await refresh({quiet:true});await openEdition(result.id);notice('Capture started. Its original operation will continue on this host.');}),
    button('Prepare following plan',()=>{selectedConnection=item.connectionId;selectedForms=item.forms.map(value=>({...value,name:value.formId}));$('plan-connection').value=item.connectionId;const target=$('plan-form');target.elements.name.value=item.name+' · following period';target.elements.submittedFrom.value=localUtc(item.scope.submittedBefore);target.elements.submittedBefore.value='';target.elements.updatedSince.value='';target.elements.pageSize.value=item.scope.pageSize;renderSelectedForms();pane('plans');notice('Following plan prepared. Choose its end date and save it.');}));
  return [item.name,item.forms.map(value=>value.formId).join(', '),(item.scope.submittedFrom?date(item.scope.submittedFrom):'All earlier submissions')+' → '+(item.scope.submittedBefore?date(item.scope.submittedBefore):'Capture start'),actions];
})):empty('Save a source cohort to create your first capture plan.'));}
bind('load-edition',()=>openEdition(chosen('edition-select','a reporting edition')));
async function openEdition(id){tableRequest++;resourceRequest++;const value=await action('edition',{id});edition=value;$('edition-select').value=id;$('edition-empty').hidden=true;$('edition-body').hidden=false;
  pane('editions');renderEditionSummary();tableOptions('table-select',edition);renderTableInformation();renderCoverage(await action('quality',{id}));renderReviewHistory();rowCursor=null;resourceCursor=null;
  replace('row-table',empty('Load the selected table to inspect its original rows.'));replace('resource-list',empty('Load original source files to inspect retained XML, form generations and media.'));
  $('next-rows').disabled=true;$('next-resources').disabled=true;}
function renderEditionSummary(){if(!edition)return;const count=edition.tables.reduce((sum,item)=>sum+item.rowCount,0),description=node('div');
  description.append(node('h2',edition.label),node('p',edition.status+' · '+count+' rows · '+edition.submissionCount+' retained submission histories · revision '+edition.revision),node('p','Started '+date(edition.startedAt)+(edition.completedAt?' · completed '+date(edition.completedAt):'')));
  if(edition.progress)description.append(node('p',[edition.progress.stage,edition.progress.form,edition.progress.instanceId].filter(Boolean).join(' · '),'small'));
  if(edition.error)description.append(node('pre',pretty(edition.error)));
  replace('edition-summary',description);$('resume-capture').disabled=edition.status==='COMPLETE'||edition.status==='CAPTURING';$('pause-capture').disabled=edition.status!=='CAPTURING';$('use-for-report').disabled=edition.status!=='COMPLETE';
  $('review-form').querySelector('button').disabled=edition.status!=='COMPLETE';
}
bind('resume-capture',async()=>{await action('resume',{id:edition.id});await refresh({quiet:true});await openEdition(edition.id);notice('Original capture resumed from its retained source cursor.');});
bind('pause-capture',async()=>{await action('pause',{id:edition.id});await refresh({quiet:true});await openEdition(edition.id);notice('Capture paused with its source progress retained.');});
bind('use-for-report',async()=>{$('output-edition').value=edition.id;await loadOutputEdition();pane('outputs');});
function renderTableInformation(){if(!edition)return;const selected=edition.tables.find(item=>item.id===$('table-select').value);if(!selected){replace('table-information',empty('Source table discovery is still in progress.'));return;}
  replace('table-information',node('p',selected.name+' · '+selected.rowCount+' rows · '+selected.pageCount+' complete source pages'+(selected.relation?' · parent '+selected.relation.parentTable+' through '+selected.relation.parentField:'')));
  replace('field-dictionary',table(['Original field path','CSDL type','Collection','Nullable','Native key'],selected.query.fields.map(field=>[field.path,field.type,field.collection?'Yes':'No',field.nullable===false?'No':'Yes',selected.query.keyFields.includes(field.path)?'Yes':''])));
}
$('table-select').addEventListener('change',()=>{tableRequest++;rowCursor=null;$('next-rows').disabled=true;renderTableInformation();replace('row-table',empty('Load rows from the selected table.'));});
async function loadRows(next=false){if(!edition)throw new Error('Open a reporting edition.');const id=edition.id,tableId=chosen('table-select','a table'),serial=++tableRequest,result=await action('rows',{id,tableId,limit:100,after:next?rowCursor||'':'',search:$('row-search').value});
  if(serial!==tableRequest||edition?.id!==id)return;rowCursor=result.next;$('next-rows').disabled=!rowCursor;
  const available=fieldsFor(edition,tableId,{scalar:true}),paths=[...new Set(['__id',...available.map(field=>field.path)])].slice(0,12);
  replace('row-table',result.rows.length?table(['Inspect',...paths],result.rows.map(row=>[button('Full row / history',()=>openRow(id,tableId,row.__id)),...paths.map(path=>{const cell=cellValue(row,path);return cell.state==='missing'?'[missing]':cell.state==='null'?'[null]':short(cell.value);})])):empty('No captured rows match this selection.'));
  notice(result.rows.length+' rows shown'+(result.next?' · next page available.':'.'));}
bind('load-rows',()=>loadRows(false));bind('next-rows',()=>loadRows(true));
function sourceDownload(receipt,label,name){return button(label,()=>download({kind:'source',hash:receipt.sha256,name:name||receipt.filename||label}),receipt.outcome!=='retained'||!receipt.sha256);}
function mediaDetails(media){const result=node('div');result.append(node('p',(media.present??0)+' / '+(media.expected??'unknown')+' attachments retained'+(media.unavailable?' · source listing unavailable':'')));
  if(media.items?.length)result.append(table(['Original filename','Outcome','Size','File'],media.items.map(item=>[item.name,item.outcome,bytes(item.bytes),sourceDownload(item,'Download',item.name)])));
  return result;}
async function openRow(id,tableId,rowId){const result=await action('row',{id,tableId,rowId}),content=[node('h3','Original captured row'),node('pre',pretty(result.row))];
  if(result.history){const history=result.history;content.push(node('h3','Original submission versions'),node('p',history.versions.length+' versions · initial instance '+history.instanceId));
    if(history.unavailable)content.push(node('p','Central did not expose a usable version list for this submission.'));
    for(const version of history.versions){const section=node('section',null,'history-version');section.append(node('h3',(version.metadata.current?'Current version · ':'Version · ')+version.metadata.instanceId),node('pre',pretty(version.metadata)),sourceDownload(version.xml,'Original submission XML',version.metadata.instanceId+'.xml'),mediaDetails(version.media));content.push(section);}}
  detail('Captured row and original history',...content);}
function renderCoverage(quality){const counts=[['Submission histories',quality.history.submissions],['Original submission XML versions',quality.history.xmlRetained],
  ['Submission media',quality.history.presentAttachments+' / '+quality.history.expectedAttachments],['Original form generations',quality.formHistory.generations],
  ['Original form XML files',quality.formHistory.xmlRetained],['Original XLS / XLSX files',quality.formHistory.originalSpreadsheets],
  ['Form media',quality.formHistory.presentAttachments+' / '+quality.formHistory.expectedAttachments],['Linked dataset attachments',quality.formHistory.linkedDatasets]];
  const content=[table(['Source coverage','Retained / expected'],counts)];
  if(quality.issues.length)content.push(table(['Review item','Affected count / source','Interpretation'],quality.issues.map(item=>[item.code,item.count??item.tableId??item.formKey??'',item.message])));
  else content.push(node('p','The captured source has no recorded coverage exceptions.'));
  content.push(button('Complete source coverage',()=>detail('Source coverage',node('pre',pretty(quality)))));
  if(edition.forms.length){const formDetails=node('details');formDetails.append(node('summary','Original published form generations'));
    for(const form of edition.forms){formDetails.append(node('h3',form.name));for(const generation of form.generations??[]){const part=node('section',null,'history-version');part.append(node('h3','Version '+(generation.version===''?'[blank original version]':generation.version)),
      sourceDownload(generation.xml,'Original form XML',form.formId+'-'+(generation.version||'blank')+'.xml'));
      if(generation.spreadsheet)part.append(sourceDownload(generation.spreadsheet,'Original spreadsheet',generation.spreadsheet.filename));
      part.append(mediaDetails(generation.media));formDetails.append(part);}}content.push(formDetails);}
  replace('coverage',...content);}
async function loadResources(next=false){if(!edition)throw new Error('Open a reporting edition.');const id=edition.id,serial=++resourceRequest,result=await action('resources',{id,after:next?resourceCursor||0:0,limit:100,kind:$('resource-kind').value});
  if(serial!==resourceRequest||edition?.id!==id)return;resourceCursor=result.next;$('next-resources').disabled=!resourceCursor;
  replace('resource-list',result.resources.length?table(['Resource','Outcome','Size','Original source','Actions'],result.resources.map(item=>{
    const actions=node('div',null,'file-list');actions.append(sourceDownload(item,'Download',item.filename||item.kind+'-'+item.sha256),button('Receipt',()=>detail('Original source receipt',node('pre',pretty(item)))));return [item.kind,item.outcome,bytes(item.bytes),short(item.url,110),actions];})):empty('No retained resources match this type.'));}
bind('load-resources',()=>loadResources(false));bind('next-resources',()=>loadResources(true));
$('resource-kind').addEventListener('change',()=>{resourceRequest++;resourceCursor=null;$('next-resources').disabled=true;});
function renderReviewHistory(){const records=edition?.decisions??[];replace('review-history',records.length?table(['Decision','Reviewer','Recorded','Interpretation'],[...records].reverse().map(item=>[item.decision,item.reviewer,date(item.createdAt),item.note])):node('p','Record the source interpretation when this edition is ready for use.'));}
form('review-form',async data=>{if(!edition)throw new Error('Open a reporting edition.');const id=edition.id,findings=String(data.get('findings')||'').trim();
  edition=await action('review',{id,expectedRevision:edition.revision,decision:data.get('decision'),reviewer:data.get('reviewer'),note:data.get('note'),findings:findings?[{title:'Analyst findings',text:findings}]:[]});
  renderEditionSummary();renderReviewHistory();await refresh({quiet:true});notice('Receiving decision saved for the original reporting edition.');});
bind('load-output-edition',()=>loadOutputEdition());
$('output-edition').addEventListener('change',()=>{outputEdition=null;$('output-body').hidden=true;$('output-empty').hidden=false;renderBaselineOptions();});
async function loadOutputEdition(){const id=chosen('output-edition','a complete edition'),value=await action('edition',{id});if(value.status!=='COMPLETE')throw new Error('Finish the retained capture before preparing its reports.');
  const changed=outputEdition?.id!==id;outputEdition=value;renderBaselineOptions();tableOptions('indicator-table',value);tableOptions('dataset-table',value);
  $('output-body').hidden=false;$('output-empty').hidden=true;renderIndicatorFields();renderDatasetFields();
  if(changed){indicators=structuredClone(value.decisions.at(-1)?.indicators||[]);$('report-form').elements.title.value=value.label+' — Field report';$('report-form').elements.narrative.value='';$('dataset-form').elements.name.value=value.label;}
  renderIndicators();notice('Complete reporting edition loaded.');}
function renderIndicatorFields(){if(!outputEdition)return;options('indicator-field',fieldsFor(outputEdition,$('indicator-table').value,{scalar:true}),{blank:'All rows · no field',value:item=>item.path,label:item=>item.path+' · '+item.type});}
$('indicator-table').addEventListener('change',renderIndicatorFields);
function renderIndicators(){replace('indicator-list',indicators.length?table(['Indicator','Table','Field','Measure','Filter',''],indicators.map((item,index)=>[item.name||item.operation,outputEdition.tables.find(value=>value.id===item.tableId)?.name||item.tableId,item.field||'All rows',item.operation,Object.hasOwn(item,'equals')?pretty(item.equals):'All values',button('Remove',()=>{indicators.splice(index,1);renderIndicators();})])):node('p','With no custom indicators, the report counts every root and repeat table.'));}
function scalarMatch(value,field,capture,tableId){const form=capture.forms.find(item=>item.key===capture.tables.find(table=>table.id===tableId).formKey);let type=field.type,seen=new Set();while(form.catalog.typeDefinitions?.[type]&&!seen.has(type)){seen.add(type);type=form.catalog.typeDefinitions[type].underlyingType||form.catalog.typeDefinitions[type].type;}
  if(type==='Edm.Boolean'){if(!['true','false'].includes(value))throw new Error('Match an original Boolean with true or false.');return value==='true';}
  if(['Edm.Byte','Edm.SByte','Edm.Int16','Edm.Int32','Edm.Single','Edm.Double'].includes(type)){if(!value.trim()||!Number.isFinite(Number(value)))throw new Error('Enter a finite original numeric value.');return Number(value);}
  return value;}
form('indicator-form',data=>{if(!outputEdition)throw new Error('Load a complete reporting edition.');const tableId=chosen('indicator-table','an indicator table'),field=$('indicator-field').value,operation=data.get('operation'),definition={name:String(data.get('name')||operation+(field?' · '+field:'')),tableId,operation,...(field?{field}:{})};
  if(operation!=='rows'&&!field)throw new Error('Choose the original field for this indicator.');
  if(data.get('match')!=='all'){if(!field)throw new Error('Choose the field whose exact value is matched.');definition.equals=data.get('match')==='null'?null:data.get('match')==='empty'?'':scalarMatch(String(data.get('value')),fieldsFor(outputEdition,tableId).find(item=>item.path===field),outputEdition,tableId);}
  indicators.push(definition);renderIndicators();notice('Indicator added to this report definition.');});
form('report-form',async data=>{if(!outputEdition)throw new Error('Load a complete reporting edition.');const result=await retainedAction('report',{id:outputEdition.id,reportId:uuid(),title:data.get('title'),narrative:data.get('narrative'),baselineId:$('baseline-select').value||null,...(indicators.length?{indicators:structuredClone(indicators)}:{})});
  await refresh({quiet:true});notice('Report created with its complete source index and period comparison files.');showOutput(result);});
function renderDatasetFields(){if(!outputEdition)return;const tableId=$('dataset-table').value,selected=outputEdition.tables.find(item=>item.id===tableId);if(!selected)return;
  const required=new Set([...selected.query.keyFields,...(selected.relation?[selected.relation.parentField]:[])]);
  const all=fieldsFor(outputEdition,tableId);replace('dataset-fields',...all.map(field=>{const label=node('label'),check=document.createElement('input');check.type='checkbox';check.value=field.path;check.checked=required.has(field.path);check.disabled=required.has(field.path);label.append(check,node('span',field.path+(required.has(field.path)?' · native key':'')));return label;}));}
$('dataset-table').addEventListener('change',renderDatasetFields);
form('dataset-form',async data=>{if(!outputEdition)throw new Error('Load a complete reporting edition.');const fields=[...$('dataset-fields').querySelectorAll('input:checked')].map(item=>item.value);if(fields.length>32)throw new Error('Choose up to 32 original fields including native keys.');
  const paymentText=String(data.get('payment')||'').trim(),origin=String(data.get('origin')||'').trim();let payment;if(paymentText){try{payment=JSON.parse(paymentText);}catch{throw new Error('The public payment configuration must be valid JSON.');}}
  const result=await retainedAction('exportDataset',{id:outputEdition.id,exportId:uuid(),tableId:chosen('dataset-table','a dataset table'),name:data.get('name'),fields,...(payment?{payment}:{}),...(origin?{origin}:{}),path:data.get('path')||'/data'});
  await refresh({quiet:true});notice('Approved dataset exported with its original field dictionary and source files.');showOutput(result);});
async function download(input){const file=await request('/api/downloads',{method:'POST',body:input}),anchor=document.createElement('a');anchor.href=file.url;anchor.download=file.name;anchor.rel='noreferrer';document.body.append(anchor);anchor.click();anchor.remove();notice('Downloading '+file.name+' · '+bytes(file.bytes)+' · SHA-256 '+file.sha256);}
function outputFiles(record){const list=node('div',null,'file-list');const primary=record.kind==='report'?['report.html','report.md','report.json']:record.kind==='archive'?record.files:['dataset.csv','dataset.json','source.json','rows.jsonl'];
  for(const path of primary.filter(path=>record.files.includes(path)))list.append(button(path,()=>download({kind:'export',id:record.id,path})));
  if(record.files.length>primary.length)list.append(button('All '+record.files.length+' files',()=>showOutput(record)));return list;}
function showOutput(record){const choice=document.createElement('select');for(const path of record.files){const option=node('option',path);option.value=path;choice.append(option);}
  const toolbar=node('div',null,'toolbar');toolbar.append(choice,button('Download selected original file',()=>download({kind:'export',id:record.id,path:choice.value}),!record.files.length));
  detail(record.title||record.dataset?.name||record.id,toolbar,node('pre',pretty(record)));}
function renderOutputs(){replace('report-list',workspace.reports.length?table(['Report','Created','Edition / comparison','Files'],descending(workspace.reports).map(item=>[item.title,date(item.createdAt),item.captureId+(item.baselineId?' · baseline '+item.baselineId:''),outputFiles(item)])):empty('Create a report from a complete reporting edition.'));
  replace('dataset-list',workspace.exports.length?table(['Dataset','Created','Rows / publishing','Files'],descending(workspace.exports).map(item=>[item.dataset?.name||item.id,date(item.createdAt),(item.dataset?.rowCount??item.dataset?.rows??'')+(item.merchant?' · merchant package':''),outputFiles(item)])):empty('Export selected fields from an accepted reporting edition.'));
  options('release-export',workspace.exports.filter(item=>item.merchant),{label:item=>item.dataset?.name||item.id});}
form('release-form',async data=>{const result=await action('prepareRelease',{exportId:chosen('release-export','a merchant dataset'),releaseId:data.get('releaseId'),label:data.get('label')});$('release-result').textContent=pretty(result);notice('Seller release prepared in the original release lifecycle.');});
bind('release-status',async()=>{const result=await action('releaseStatus');$('release-result').textContent=pretty(result);if(Number.isSafeInteger(result.state?.generation))$('release-generation').value=result.state.generation;notice('Original seller release state received.');});
bind('release-activate',async()=>{const expectedGeneration=Number($('release-generation').value);if($('release-generation').value===''||!Number.isSafeInteger(expectedGeneration))throw new Error('Read the current release generation first.');const id=$('release-form').elements.releaseId.value.trim();if(!id)throw new Error('Choose the prepared release ID.');
  const result=await action('activateRelease',{id,expectedGeneration,reason:$('release-reason').value});$('release-result').textContent=pretty(result);notice('Selected seller release activated.');});
function renderWorkspace(){replace('workspace-information',table(['Workspace','Original identity'],[['Workspace ID',workspace.id],['Revision',workspace.revision],['Created',date(workspace.createdAt)],['Received original archive',workspace.receivedArchive?.archiveSha256||'Created on this host']]));
  replace('archive-list',workspace.archives.length?table(['Archive','Created','Size','Files'],descending(workspace.archives).map(item=>[item.id,date(item.createdAt),bytes(item.bytes),item.files.length?outputFiles(item):node('span','Previous archive receipt retained')])):empty('Create a portable archive to move the complete workspace to another host.'));}
bind('create-archive',async()=>{notice('Creating the complete portable workspace. Keep this original operation available.');const result=await retainedAction('backup',{id:uuid()});await refresh({quiet:true});notice('Complete portable archive created.');showOutput(result);});
try{for(const item of JSON.parse(readStorage('pending')||'[]'))if(item?.id&&pendingCollection(item.method))pending.set(item.id,item);}catch{/* A malformed browser draft cannot alter the host workspace. */}
const fragment=new URLSearchParams(location.hash.slice(1));token=fragment.get('token')||readStorage('token')||'';
if(fragment.has('token')){writeStorage('token',token);history.replaceState(null,'',location.pathname+location.search);}
renderSelectedForms();renderPending();
if(token)refresh().catch(showError);else{$('unlock').hidden=false;for(const section of document.querySelectorAll('.pane'))section.hidden=true;notice('Open the private operator link or enter its token.');}
