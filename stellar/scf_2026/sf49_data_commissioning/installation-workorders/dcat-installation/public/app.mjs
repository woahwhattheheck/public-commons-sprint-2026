// SPDX-License-Identifier: MIT
const $=id=>document.getElementById(id);
const text=(tag,value,cls)=>{const e=document.createElement(tag);e.textContent=String(value??'');if(cls)e.className=cls;return e;};
const state={schema:'stellar-forge.dcat-installation-editor.v1',inputs:{},inspectionId:null,templateId:null,source:null,selection:null,bindings:null,selectionSourceId:'',selectionDirty:true,bindingText:{},bindingErrors:{},pending:null,result:null};
let token=new URLSearchParams(location.hash.slice(1)).get('token')??'',busy=false,page=0,filePage=0,historyOffset=0,saveQueue=Promise.resolve();
if(token)history.replaceState(null,'',location.pathname+location.search);
const message=value=>{$('status').textContent=value;};
const canonical=value=>JSON.stringify((function ordered(v){return Array.isArray(v)?v.map(ordered):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,ordered(v[k])])):v;})(value));
const readable=value=>value.replace(/([a-z])([A-Z])/g,'$1 $2').replace(/^./,x=>x.toUpperCase());
const hex=raw=>Array.from(new Uint8Array(raw),b=>b.toString(16).padStart(2,'0')).join('');
const bytes=value=>new TextEncoder().encode(JSON.stringify(value,null,2)+'\n');
const sha=async raw=>hex(await crypto.subtle.digest('SHA-256',raw));
const uuid=()=>crypto.randomUUID();
let database;
async function db(){
 return database??=new Promise((resolve,reject)=>{
  const request=indexedDB.open('dcat-installation-editor',1);
  request.onupgradeneeded=()=>request.result.createObjectStore('draft');
  request.onsuccess=()=>resolve(request.result);request.onerror=()=>reject(request.error);
 });
}
async function remember(){
 const snapshot=structuredClone({...state,source:null,result:null});
 saveQueue=saveQueue.catch(()=>{}).then(async()=>{
  const database=await db();
  await new Promise((resolve,reject)=>{const tx=database.transaction('draft','readwrite');tx.objectStore('draft').put(snapshot,'current');tx.oncomplete=resolve;tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error??new Error('Local draft save was interrupted.'));});
 });
 try{await saveQueue;}catch(error){message('The browser could not retain this draft. Download the complete editor draft before closing. '+error.message);}
}
async function restore(){
 try{
  const database=await db(),saved=await new Promise((resolve,reject)=>{const tx=database.transaction('draft');const r=tx.objectStore('draft').get('current');r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});
  if(saved?.schema===state.schema)Object.assign(state,saved);
 }catch(error){message('Browser draft storage is unavailable. Complete request history remains in the preparation directory. '+error.message);}
}
async function api(path,{method='GET',body,raw=false}={}){
 const headers={Authorization:'Bearer '+token};if(body!==undefined&&!raw)headers['Content-Type']='application/json';
 const response=await fetch(path,{method,headers,body:body===undefined?undefined:raw?body:JSON.stringify(body),cache:'no-store'});
 if(!response.ok){let value;try{value=await response.json();}catch{value={message:response.statusText};}throw new Error(value.message??'The original preparation request failed.');}
 return response.json();
}
async function originalSelectionUnchanged(){
 if(state.selectionDirty!==false||!state.inputs.selection||!state.selection)return false;
 const retained=await api('/api/files/'+state.inputs.selection.fileId);
 if(canonical(retained)!==canonical(state.selection)){state.selectionDirty=true;await remember();return false;}
 return true;
}
async function run(work){
 if(busy)return;busy=true;$('controls').inert=true;$('refresh').disabled=true;
 try{await work();}catch(error){message(error.message);}finally{busy=false;$('controls').inert=false;$('refresh').disabled=false;renderPending();}
}
function saveBlob(blob,name){
 const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);
}
function downloadJSON(value,name){saveBlob(new Blob([bytes(value)],{type:'application/json'}),name);}
async function download(path,name){
 const response=await fetch(path,{headers:{Authorization:'Bearer '+token},cache:'no-store'});
 if(!response.ok){let value;try{value=await response.json();}catch{value={message:response.statusText};}throw new Error(value.message);}
 saveBlob(await response.blob(),name);
}
function fileRow(row){
 const line=text('div','', 'file-row'),label=text('span',row.name+' · '+row.bytes.toLocaleString()+' bytes');
 label.append(text('div',row.sha256,'metadata'));const button=text('button','Download complete file');button.type='button';
 button.addEventListener('click',()=>run(()=>download('/api/files/'+row.fileId,row.name)));line.append(label,button);return line;
}
function renderInputs(){
 $('inputs').replaceChildren();
 for(const kind of ['archive','case','seed','selection','bindings']){
  const row=state.inputs[kind];if(!row)continue;
  const e=text('div','', 'record');e.append(text('h3',readable(kind)),fileRow(row));$('inputs').append(e);
 }
}
function filtered(){
 const family=$('family').value,query=$('query').value.trim().toLowerCase();
 return(state.source?.records??[]).filter(r=>(!family||r.family===family)&&(!query||[r.key,r.id,r.label,r.state,r.ownerId,r.revisionId].filter(x=>x!=null).join(' ').toLowerCase().includes(query)));
}
function renderScope(){
 $('scope-section').hidden=!state.source;
 if(!state.source)return;
 renderArchiveFiles();
 const family=$('family').value;const families=[...new Set(state.source.records.map(r=>r.family))].sort();
 $('family').replaceChildren(new Option('All families',''),...families.map(f=>new Option(readable(f.replaceAll('-',' ')),f)));
 if(families.includes(family))$('family').value=family;
 $('archive-source-id').value=state.selection?.archive?.sourceId??'';
 const rows=filtered();page=Math.min(page,Math.max(0,Math.ceil(rows.length/50)-1));const selected=new Map((state.selection?.records??[]).map(r=>[r.key,r]));
 $('scope-count').textContent=rows.length?'Showing '+(page*50+1)+'–'+Math.min((page+1)*50,rows.length)+' of '+rows.length+' matching records; '+state.source.records.length+' records retained.':'No matching records.';
 $('previous').disabled=page===0;$('next').disabled=(page+1)*50>=rows.length;$('scope').replaceChildren();
 for(const row of rows.slice(page*50,(page+1)*50)){
  const section=text('article','','record');section.append(text('h3',row.label||row.key),text('p',[row.family,row.id,row.revisionId,row.state].filter(x=>x!==undefined&&x!==null).map(String).join(' · '),'metadata'));
  const choice=selected.get(row.key);
  if(choice){
   const label=text('label'),check=document.createElement('input');check.type='checkbox';check.checked=choice.included;
   check.addEventListener('change',()=>{choice.included=check.checked;state.selectionDirty=true;void remember();});label.append(check,document.createTextNode('Include in commissioned work'));
   const purposeLabel=text('label','Purpose'),purpose=document.createElement('textarea');purpose.rows=2;purpose.maxLength=4000;purpose.value=choice.purpose;
   purpose.addEventListener('input',()=>{choice.purpose=purpose.value;state.selectionDirty=true;void remember();});purposeLabel.append(purpose);section.append(label,purposeLabel);
  }
  const details=document.createElement('details');details.append(text('summary','Complete original record'),text('pre',JSON.stringify(row.metadata,null,2)));
  if(row.relationships?.length)details.append(text('h3','Related original records'),text('pre',JSON.stringify(row.relationships,null,2)));
  for(const f of row.files??[]){
   const line=text('div','','file-row'),label=text('span',f.path+' · '+f.bytes.toLocaleString()+' bytes'),button=text('button','Download original file');
   label.append(text('div',f.sha256,'metadata'));button.addEventListener('click',()=>run(()=>download('/api/sources/'+state.inspectionId+'/file?path='+encodeURIComponent(f.path),f.path.split('/').at(-1))));line.append(label,button);details.append(line);
  }
  section.append(details);$('scope').append(section);
 }
}
const sections={
 task:['name','purpose','request','completeOutput','repeatTrigger','pricedUnit'],
 source:['sourceIds','reference','mode','population','meaning','authority','changePolicy'],
 payment:['network','asset','recipient','priceAtomic','taskBudgetAtomic','taskUnits','authority','termsSourceIds','facilitators'],
 receiving:['application','host','operator','acceptanceRule','changeAndWithdraw','recovery','maintenance','sourceIds']
};
function bindingField(parent,object,key,path=key){
 state.bindingText??={};state.bindingErrors??={};
 const label=text('label',readable(key)),array=['sourceIds','termsSourceIds','buyerDeploymentIds'].includes(key);
 const numeric=key==='taskUnits',atomic=['priceAtomic','taskBudgetAtomic'].includes(key),facilitators=key==='facilitators';
 const long=!numeric&&!atomic&&!['merchantDeploymentId','network','asset','recipient','host','operator'].includes(key);
 const input=document.createElement(long?'textarea':'input');if(long)input.rows=facilitators?6:array?3:2;else input.type='text';
 input.value=facilitators?JSON.stringify(object[key]??[],null,2):array?(object[key]??[]).join('\n'):object[key]??'';
 if(Object.hasOwn(state.bindingText,path))input.value=state.bindingText[path];
 input.setCustomValidity(state.bindingErrors[path]??'');
 if(numeric)input.inputMode='numeric';if(atomic)input.inputMode='numeric';
 input.addEventListener('input',()=>{
  state.bindingText[path]=input.value;
  try{
   if(facilitators){const parsed=JSON.parse(input.value);if(!Array.isArray(parsed))throw new Error('Use the complete facilitator list.');object[key]=parsed;}
   else if(array)object[key]=input.value.split(/\r?\n/).map(x=>x.trim()).filter(Boolean);
   else if(numeric){if(input.value!==''&&!/^(0|[1-9][0-9]*)$/.test(input.value))throw new Error('Use a whole task count or leave it unselected.');const value=input.value===''?null:Number(input.value);if(value!==null&&!Number.isSafeInteger(value))throw new Error('The task count is outside the supported integer range.');object[key]=value;}
   else if(atomic||key==='merchantDeploymentId')object[key]=input.value===''?null:input.value;
   else object[key]=input.value;
   input.setCustomValidity('');delete state.bindingErrors[path];
  }catch(error){input.setCustomValidity(error.message);state.bindingErrors[path]=error.message;}
  void remember();
 });
 label.append(input);parent.append(label);
}
function renderArchiveFiles(){
 const term=$('file-query').value.trim().toLowerCase(),rows=(state.source?.manifest?.files??[]).filter(x=>!term||x.path.toLowerCase().includes(term));
 filePage=Math.min(filePage,Math.max(0,Math.ceil(rows.length/100)-1));$('archive-files').replaceChildren();
 $('file-count').textContent=rows.length+' complete matching files; page '+(filePage+1)+' of '+Math.max(1,Math.ceil(rows.length/100))+'.';
 for(const row of rows.slice(filePage*100,(filePage+1)*100)){
  const line=text('div','','file-row'),label=text('span',row.path+' · '+row.bytes.toLocaleString()+' bytes'),button=text('button','Download original file');label.append(text('div',row.sha256,'metadata'));
  button.addEventListener('click',()=>run(()=>download('/api/sources/'+state.inspectionId+'/file?path='+encodeURIComponent(row.path),row.path.split('/').at(-1))));line.append(label,button);$('archive-files').append(line);
 }
 $('file-previous').disabled=filePage===0;$('file-next').disabled=(filePage+1)*100>=rows.length;
}
function renderBindings(){
 $('bindings-section').hidden=!state.bindings;
 if(!state.bindings)return;
 $('binding-selection').replaceChildren(text('p','Case '+state.bindings.selection.caseId+' · version '+state.bindings.selection.version+' · Workshare '+(state.bindings.workshareCaseId??'Unselected'),'metadata'));
 $('bindings').replaceChildren();bindingField($('bindings'),state.bindings,'merchantDeploymentId');bindingField($('bindings'),state.bindings,'buyerDeploymentIds');
 for(const [section,fields]of Object.entries(sections)){
  state.bindings[section]??={};
  const box=text('div','','binding-group');box.append(text('h3',readable(section)));
  for(const key of fields)bindingField(box,state.bindings[section],key,section+'.'+key);$('bindings').append(box);
 }
 $('selection-source-id').value=state.selectionSourceId;
}
function renderResult(result=state.result){
 if(!result)return;$('result').replaceChildren(text('h3',readable(result.type)+' · '+result.requestId));
 if(result.type==='prepare'){
  $('result').append(text('p','Download the complete Installation input and open it in the original case’s Customer installations desk. Preview and save it there, then export and independently receive the complete case.'));
  if(result.selections?.length){$('result').append(text('h3','Selections to complete in the original case'));const list=text('ul');for(const r of result.selections)list.append(text('li',r.field+': '+r.purpose));$('result').append(list);}
  const details=document.createElement('details');details.append(text('summary','Complete prepared Installation'),text('pre',JSON.stringify(result.installation,null,2)));$('result').append(details);
 }
 for(const f of result.files??[])$('result').append(fileRow(f));
}
function renderPending(){
 const pending=state.pending;$('pending-section').hidden=!pending;
 $('pending-description').textContent=pending?'Request '+pending.requestId+' · '+pending.action+'. Reconcile its retained result or continue with the same complete inputs.':'';
 for(const id of ['import','inspect','template','prepare'])$(id).disabled=!!pending;
}
async function adopt(result,{carry=true}={}){
 state.result=result;
 if(result.type==='import'){
  if(['selection','bindings'].includes(result.file.kind))state[result.file.kind]=await api('/api/files/'+result.file.fileId);
  if(result.file.kind==='bindings'){state.bindingText={};state.bindingErrors={};}
  if(result.file.kind==='selection')state.selectionDirty=false;
  state.inputs[result.file.kind]=result.file;
 }
 if(result.type==='inspect'){
  if(state.inspectionId!==result.requestId&&state.source?.sourceSha256!==result.source?.sourceSha256){state.selection=null;state.bindings=null;state.templateId=null;}
  state.inspectionId=result.requestId;state.source=result.source;
 }
 if(result.type==='template'){
  const oldBindings=state.bindings,oldSelection=state.selection,oldDirty=state.selectionDirty;
  state.templateId=result.requestId;state.bindings=structuredClone(result.bindings);state.selection=structuredClone(result.selection);
  if(carry&&oldBindings?.selection?.caseId===result.bindings.selection.caseId&&oldBindings.workshareCaseId===result.bindings.workshareCaseId&&oldSelection?.sourceSha256===result.selection.sourceSha256){
   for(const key of ['merchantDeploymentId','buyerDeploymentIds',...Object.keys(sections)])if(Object.hasOwn(oldBindings,key))state.bindings[key]=structuredClone(oldBindings[key]);
   const prior=new Map(oldSelection.records.map(r=>[r.key,r]));
   for(const row of state.selection.records){const previous=prior.get(row.key);if(previous?.recordSha256===row.recordSha256){row.included=previous.included;row.purpose=previous.purpose;}}
  }else{state.bindingText={};state.bindingErrors={};}
  state.selectionDirty=oldDirty!==false||!state.inputs.selection||canonical(oldSelection)!==canonical(state.selection);
 }
 if(state.pending?.requestId===result.requestId)state.pending=null;
 await remember();renderInputs();renderScope();renderBindings();renderResult();renderPending();
 message(readable(result.type)+' retained under request '+result.requestId+'.');
}
async function mutate(action,body){
 if(state.pending)throw new Error('Continue the retained request or retain it and start a new draft first.');
 const requestId=uuid();state.pending={action,requestId,body:{...body,requestId},carry:$('carry-choices').checked};await remember();renderPending();
 const result=await api('/api/'+action,{method:'POST',body:state.pending.body});await adopt(result,{carry:state.pending.carry});return result;
}
async function upload(kind,file,{textValue=null}={}){
 if(state.pending)throw new Error('Continue the retained request before importing another file.');
 if(file.size>(kind==='archive'?128:8)*1024*1024)throw new Error('The complete input exceeds the selected receiving capacity.');
 const buffer=await file.arrayBuffer(),digest=await sha(buffer),requestId=uuid();
 state.pending={action:'import',requestId,kind,name:file.name,bytes:buffer.byteLength,sha256:digest,text:textValue};await remember();renderPending();
 return continueUpload(buffer);
}
async function continueUpload(buffer){
 const pending=state.pending;if(!pending||pending.action!=='import')throw new Error('Select the original retained file request.');
 if(buffer.byteLength!==pending.bytes||await sha(buffer)!==pending.sha256)throw new Error('Select the same complete file for the retained upload.');
 const query=new URLSearchParams(Object.fromEntries(['requestId','kind','name','bytes','sha256'].map(k=>[k,String(pending[k])])));
 const result=await api('/api/import?'+query,{method:'PUT',body:buffer,raw:true});await adopt(result);return result;
}
async function restoreRecordInputs(result,inspected=null){
 if(!['template','prepare'].includes(result.type))return;
 const request=result.request??{},files=result.files??[],next={};
 const choose=(kind,key)=>files.find(f=>f.fileId===request[key])??files.find(f=>f.kind===kind);
 for(const [kind,key]of [['case','caseId'],['seed','seedId'],['bindings','bindingsId'],['selection','selectionId']]){const file=choose(kind,key);if(file)next[kind]=file;}
 const archive=(inspected?.files??files).find(f=>f.fileId===(inspected?.archiveId??result.archiveId))??files.find(f=>f.kind==='archive');if(archive)next.archive=archive;
 state.inputs=next;state.bindingText={};state.bindingErrors={};state.selectionSourceId=request.selectionSourceId??'';
 if(next.bindings)state.bindings=await api('/api/files/'+next.bindings.fileId);
 if(next.selection){state.selection=await api('/api/files/'+next.selection.fileId);state.selectionDirty=false;}
}
async function historyPage(reset=false){
 if(reset){historyOffset=0;$('history').replaceChildren();}
 const result=await api('/api/requests?offset='+historyOffset+'&limit=50');
 for(const row of result.rows){
  const box=text('div','','file-row'),label=text('span',readable(row.type)+' · '+row.status+' · '+row.requestId),button=text('button','Reopen');
  button.addEventListener('click',()=>run(async()=>{
   if(state.pending&&state.pending.requestId!==row.requestId)throw new Error('Retain or continue the current pending request before reopening another selection.');
   const result=await api('/api/requests/'+row.requestId);
   if(result.status==='PENDING'){
    if(state.pending&&state.pending.requestId!==row.requestId)throw new Error('Retain the current pending request before selecting this one.');
    state.pending=result.type==='import'?{action:'import',...result.request}:{action:result.type,requestId:row.requestId,body:result.request};await remember();renderPending();message('Original request selected for continuation.');
   }else{
    let inspected=null;if(result.inspectionId){inspected=await api('/api/requests/'+result.inspectionId);state.inspectionId=result.inspectionId;state.source=inspected.source;}
    await restoreRecordInputs(result,inspected);await adopt(result,{carry:false});
   }
  }));box.append(label,button);$('history').append(box);
 }
 historyOffset=result.nextOffset;$('more-history').hidden=historyOffset===null;
}
$('import').addEventListener('click',()=>run(async()=>{const file=$('input-file').files[0];if(!file)throw new Error('Choose the complete original file.');await upload($('input-kind').value,file);await historyPage(true);}));
$('inspect').addEventListener('click',()=>run(async()=>{if(!state.inputs.archive)throw new Error('Retain the complete catalogue archive first.');await mutate('inspect',{archiveId:state.inputs.archive.fileId});await historyPage(true);}));
$('template').addEventListener('click',()=>run(async()=>{if(!state.inspectionId||!state.inputs.case||!state.inputs.seed)throw new Error('Inspect the catalogue and retain the current case and original seed first.');await mutate('template',{inspectionId:state.inspectionId,caseId:state.inputs.case.fileId,seedId:state.inputs.seed.fileId});await historyPage(true);}));
$('prepare').addEventListener('click',()=>run(async()=>{
 for(const element of $('bindings').querySelectorAll('input,textarea'))if(!element.reportValidity())throw new Error('Complete the indicated customer binding.');
 if(!state.selection||!state.bindings||!state.selectionSourceId)throw new Error('Select the scope, customer bindings and scope file’s original case source ID.');
 if(state.selection.records.some(r=>typeof r.purpose!=='string'||!r.purpose.trim()))throw new Error('Record a purpose for every included or context source record.');
 for(const [kind,name,value]of [['selection','Selected_Dcat_Scope.json',state.selection],['bindings','bindings.json',state.bindings]]){
  if(kind==='selection'&&await originalSelectionUnchanged())continue;
  if(kind==='bindings'&&state.inputs.bindings&&canonical(await api('/api/files/'+state.inputs.bindings.fileId))===canonical(value))continue;
  const textValue=JSON.stringify(value,null,2)+'\n';await upload(kind,new File([textValue],name,{type:'application/json'}),{textValue});
 }
 await mutate('prepare',{inspectionId:state.inspectionId,caseId:state.inputs.case.fileId,seedId:state.inputs.seed.fileId,bindingsId:state.inputs.bindings.fileId,selectionId:state.inputs.selection.fileId,selectionSourceId:state.selectionSourceId});await historyPage(true);
}));
$('resume').addEventListener('click',()=>run(async()=>{
 const pending=state.pending;if(!pending)return;
 try{const result=await api('/api/requests/'+pending.requestId);if(result.status==='COMPLETE'){await adopt(result,{carry:pending.carry});await historyPage(true);return;}}catch(error){if(!/no such file|ENOENT|not found/i.test(error.message))throw error;}
 if(pending.action==='import'){
  const buffer=pending.text!==undefined&&pending.text!==null?new TextEncoder().encode(pending.text).buffer:await $('input-file').files[0]?.arrayBuffer();
  if(!buffer)throw new Error('Choose the same original file, then continue this request.');
  await continueUpload(buffer);
 }else await adopt(await api('/api/'+pending.action,{method:'POST',body:pending.body}),{carry:pending.carry});
 await historyPage(true);
}));
$('new-draft').addEventListener('click',()=>run(async()=>{state.pending=null;await remember();renderPending();message('Original request retained in preparation history. The editor is ready for a new request.');}));
$('family').addEventListener('change',()=>{page=0;renderScope();});$('query').addEventListener('input',()=>{page=0;renderScope();});
$('file-query').addEventListener('input',()=>{filePage=0;renderArchiveFiles();});$('file-previous').addEventListener('click',()=>{filePage--;renderArchiveFiles();});$('file-next').addEventListener('click',()=>{filePage++;renderArchiveFiles();});
$('previous').addEventListener('click',()=>{page--;renderScope();});$('next').addEventListener('click',()=>{page++;renderScope();});
$('bulk-apply').addEventListener('click',()=>run(async()=>{if(!state.selection)throw new Error('Prepare the scope template first.');const purpose=$('bulk-purpose').value;if(!purpose.trim())throw new Error('Record a purpose for these matching records.');const keys=new Set(filtered().map(r=>r.key));for(const row of state.selection.records)if(keys.has(row.key)){row.included=$('bulk-decision').value==='true';row.purpose=purpose;}state.selectionDirty=true;await remember();renderScope();message('Updated '+keys.size+' matching scope records.');}));
$('archive-source-id').addEventListener('input',()=>{if(state.selection){state.selection.archive.sourceId=$('archive-source-id').value;state.selectionDirty=true;void remember();}});
$('selection-source-id').addEventListener('input',()=>{state.selectionSourceId=$('selection-source-id').value;void remember();});
$('download-selection').addEventListener('click',()=>run(async()=>{if(!state.selection)return;if(await originalSelectionUnchanged())await download('/api/files/'+state.inputs.selection.fileId,state.inputs.selection.name);else downloadJSON(state.selection,'Selected_Dcat_Scope.json');}));
$('download-source').addEventListener('click',()=>{if(state.source)downloadJSON(state.source,'Dcat_Complete_Source_Report.json');});
$('download-bindings').addEventListener('click',()=>{if(Object.keys(state.bindingErrors??{}).length){message('Finish the indicated binding, or download the complete editor draft to retain unfinished input.');return;}downloadJSON(state.bindings,'bindings.json');});
$('save-draft').addEventListener('click',()=>downloadJSON(state,'Catalogue_Installation_Editor.json'));
$('open-draft').addEventListener('change',()=>run(async()=>{
 const file=$('open-draft').files[0];if(!file)return;if(file.size>256*1024*1024)throw new Error('Select a complete editor draft within its 256 MiB capacity.');
 const value=JSON.parse(await file.text());if(value.schema!==state.schema||!value.inputs||!value.inspectionId)throw new Error('Select the original complete catalogue Installation editor draft.');
 const inspected=await api('/api/requests/'+value.inspectionId);
 if(inspected.type!=='inspect'||inspected.source.sourceSha256!==value.source?.sourceSha256)throw new Error('Reopen this draft with its original preparation directory and catalogue.');
 Object.assign(state,value,{source:inspected.source});await remember();renderInputs();renderScope();renderBindings();renderResult();renderPending();message('Complete editor draft reopened.');
}));
$('more-history').addEventListener('click',()=>run(()=>historyPage()));
$('refresh').addEventListener('click',()=>run(async()=>{await api('/api/launch');await historyPage(true);message('Retained preparation history refreshed.');}));
async function start(){
 if(!token){$('authentication').hidden=false;$('controls').hidden=true;message('Open the original private desk link.');return;}
 await api('/api/launch');$('authentication').hidden=true;$('controls').hidden=false;
 if(state.inspectionId){const row=await api('/api/requests/'+state.inspectionId);state.source=row.source;}
 renderInputs();renderScope();renderBindings();renderResult();renderPending();await historyPage(true);message('Retained catalogue preparation ready.');
}
$('authenticate').addEventListener('click',()=>run(async()=>{token=$('credential').value;$('credential').value='';await start();}));
await restore();await run(start);
