'use strict';
const $=selector=>document.querySelector(selector),$$=selector=>[...document.querySelectorAll(selector)];
const token=location.hash.slice(1)||sessionStorage.getItem('hdf5-capability')||'';
if(token){sessionStorage.setItem('hdf5-capability',token);history.replaceState(null,'',location.pathname);}
const state={tab:'sources',source:null,version:null,object:null,edition:null,lastEdition:null,publisherAutoEdition:null,epoch:0,operationView:0,operation:null,lastOperation:null,
  sourceOffset:'0',sourceNext:null,versionNext:null,linkNext:null,attributeNext:null,offsets:{selections:'0',editions:'0',operations:'0'},next:{},valuesNext:null};
const epochs=new WeakMap(),busyForms=new WeakSet(),busyControls=new WeakSet(),automaticOperations=new WeakMap(),reads=new Map();
function touch(form){epochs.set(form,(epochs.get(form)??0)+1);}
function claimRead(key){const generation=(reads.get(key)??0)+1;reads.set(key,generation);return()=>reads.get(key)===generation;}
function formSubmit(form){return form.querySelector('button[type=submit],button:not([type])');}
for(const form of $$('form')){
  epochs.set(form,0);
  const changed=()=>{
    touch(form);
    if(form.id==='browse-form')clearObject('Inspect the selected version and path.');
    if(form.id==='result-form')clearEdition('Open the selected edition to use its values.');
    if(form.id==='operation-form'){state.operationView++;clearOperation('Read this operation ID to inspect its saved state.');}
  };
  form.addEventListener('input',changed);form.addEventListener('change',changed);
}
const text=(selector,value)=>{$(selector).textContent=typeof value==='string'?value:JSON.stringify(value,null,2);};
let noticeGeneration=0;
function writeNotice(message,error=false){text('#notice',message);$('#notice').dataset.error=String(error);}
function notice(message,error=false){noticeGeneration++;writeNotice(message,error);}
function requestNotice(message){
  const generation=++noticeGeneration;writeNotice(message);
  return(message,error=false)=>{if(generation===noticeGeneration)writeNotice(message,error);};
}
function newOperation(formId){
  const form=document.getElementById(formId),ident=crypto.randomUUID();
  form.elements.operation.value=ident;automaticOperations.set(form,ident);touch(form);
}
function changeOperationTarget(form,previous,next){
  if(previous&&previous!==next&&form.elements.operation.value===automaticOperations.get(form))newOperation(form.id);
}
for(const button of $$('[data-new-operation]'))button.addEventListener('click',()=>newOperation(button.dataset.newOperation));
for(const form of $$('form'))if(form.elements.operation)newOperation(form.id);
function show(tab){
  state.tab=tab;state.epoch++;
  for(const panel of $$('[data-panel]'))panel.hidden=panel.dataset.panel!==tab;
  for(const button of $$('[data-tab]'))button.setAttribute('aria-selected',String(button.dataset.tab===tab));
}
for(const button of $$('[data-tab]'))button.addEventListener('click',()=>{
  show(button.dataset.tab);
  if(['selections','results','operations'].includes(state.tab))refreshCollection(state.tab==='results'?'editions':state.tab).catch(error=>notice(error.message,true));
});
async function response(response){
  let data;try{data=await response.json();}catch{throw new Error('The operator returned no complete JSON response. Read the saved operation ID before resuming it.');}
  if(!response.ok)throw Object.assign(new Error(data.message??data.error),{code:data.error,status:response.status});return data;
}
async function api(action,payload={}){
  return response(await fetch('/api/action',{method:'POST',headers:{authorization:'Bearer '+token,'content-type':'application/json'},body:JSON.stringify({action,payload})}));
}
async function upload(file,kind='source',expected){
  if(!(file instanceof File)||file.size===0)throw new Error('Choose the complete source file or packet.');
  return response(await fetch('/api/upload?kind='+kind,{method:'POST',headers:{authorization:'Bearer '+token,...(expected?{'x-content-sha256':expected}:{})},body:file}));
}
function parseJson(source,{axisIntegers=false}={}){
  const value=JSON.parse(source);
  // Scan only JSON number tokens, leaving quoted decimal integers and field names intact.
  let quoted=false,escaped=false;
  for(let index=0;index<source.length;index++){
    const character=source[index];
    if(quoted){if(escaped)escaped=false;else if(character==='\\')escaped=true;else if(character==='"')quoted=false;continue;}
    if(character==='"'){quoted=true;continue;}
    if(character==='-'||/[0-9]/.test(character)){
      const literal=/^-?(?:0|[1-9][0-9]*)(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?/.exec(source.slice(index))[0];
      const number=Number(literal);
      if(!Number.isFinite(number)||Number.isInteger(number)&&!Number.isSafeInteger(number))
        throw new Error('An unquoted JSON number exceeds the browser’s exact integer range. Use a decimal string where the field accepts one.');
      if(axisIntegers&&(!/^(0|[1-9][0-9]*)$/.test(literal)||!Number.isSafeInteger(number)))
        throw new Error('Axis numbers must be nonnegative safe integers. Use quoted decimal integers for larger values.');
      index+=literal.length-1;
    }
  }
  return value;
}
function table(target,columns,items){
  const root=$(target);root.replaceChildren();
  if(!items.length){const p=document.createElement('p');p.className='empty';p.textContent='No retained records on this page.';root.append(p);return;}
  const wrapper=document.createElement('div');wrapper.className='table-wrap';
  const grid=document.createElement('table'),head=document.createElement('thead'),row=document.createElement('tr');
  for(const column of columns){const th=document.createElement('th');th.scope='col';th.textContent=column.label;row.append(th);}
  head.append(row);grid.append(head);
  const body=document.createElement('tbody');
  for(const item of items){
    const tr=document.createElement('tr');
    for(const column of columns){const td=document.createElement('td'),value=column.value(item);if(value instanceof Node)td.append(value);else td.textContent=value??'';tr.append(td);}
    body.append(tr);
  }
  grid.append(body);wrapper.append(grid);root.append(wrapper);
}
function button(label,run){
  const b=document.createElement('button');b.type='button';b.textContent=label;
  b.addEventListener('click',()=>Promise.resolve().then(run).catch(error=>notice(error.message,true)));return b;
}
const shortened=value=>value?value.slice(0,12)+'…':'';
function updateObjectControls(){
  $('#object-parent').disabled=!state.object||state.object.path==='/';
  $('#select-object').disabled=state.object?.kind!=='dataset';
  $('#links-next').disabled=!state.object||!state.linkNext;
  $('#attributes-next').disabled=!state.object||!state.attributeNext;
}
function updateEditionControls(){
  $('#values-first').disabled=!state.edition;$('#values-next').disabled=!state.edition||!state.valuesNext;
  for(const ident of ['query-form','export-form']){const form=document.getElementById(ident);formSubmit(form).disabled=!state.edition||busyForms.has(form);}
}
function updateOperationControls(){
  const ident=$('#operation-form').elements.ident.value,operation=state.operation?.id===ident?state.operation:null;
  const cancel=$('#cancel-operation'),resume=$('#resume-operation');
  cancel.disabled=busyControls.has(cancel)||!ident||!!(operation&&(operation.commitStarted||['committing','completed','cancelled'].includes(operation.state)));
  resume.disabled=busyControls.has(resume)||!ident;
  $('#last-operation').disabled=!state.lastOperation;
}
function rememberOperation(ident){
  state.lastOperation=ident;
  try{localStorage.setItem('hdf5-last-operation',ident);}catch{}
  updateOperationControls();
}
function bindForm(id,work){
  const form=document.getElementById(id);
  form.addEventListener('submit',async event=>{
    event.preventDefault();if(busyForms.has(form))return;
    busyForms.add(form);const epoch=epochs.get(form),navigation=state.epoch,submit=formSubmit(form);submit.disabled=true;
    const data=Object.fromEntries(new FormData(form)),current=()=>epochs.get(form)===epoch&&state.epoch===navigation;
    const report=requestNotice('Running '+id.replace('-form','')+'…');
    try{
      if(data.operation)rememberOperation(data.operation);
      await work(data,current);
      report(data.operation?'Request returned. Operation ID: '+data.operation+'. Use Operations to read its saved state.':'Request returned. Review the displayed result and its saved state.');
    }catch(error){report(error.message,true);}
    finally{busyForms.delete(form);submit.disabled=false;updateEditionControls();updateObjectControls();updateOperationControls();}
  });
}
async function refresh(offset=state.sourceOffset){
  state.sourceOffset=offset;const selected=claimRead('sources');state.sourceNext=null;$('#sources-next').disabled=true;text('#sources-table','Loading sources…');
  let result;
  try{result=await api('status',{offset,limit:50});}catch(error){if(selected())throw error;return;}
  if(!selected()||offset!==state.sourceOffset)return;
  text('#counts',Object.entries(result.counts).map(([key,value])=>value+' '+key).join(' · '));state.sourceNext=result.next;
  table('#sources-table',[{label:'Source',value:row=>button(row.label,()=>chooseSource(row.id))},{label:'ID',value:row=>row.id},{label:'Current version',value:row=>shortened(row.head)}],result.sources);
  $('#sources-next').disabled=!result.next;
}
async function chooseSource(source){
  state.source=source;state.epoch++;const epoch=state.epoch,form=$('#import-form'),draft=epochs.get(form),selected=claimRead('source');
  state.versionNext=null;$('#versions-next').disabled=true;text('#versions-table','Loading the selected source…');claimRead('versions');
  let result;
  try{result=await api('source.get',{source});}catch(error){if(selected()&&epoch===state.epoch)throw error;return;}
  if(!selected()||epoch!==state.epoch||source!==state.source)return;
  if(epochs.get(form)===draft){
    const changed=form.elements.source_id.value!==result.id||form.elements.expected_head.value!==(result.head??'');
    form.elements.source_id.value=result.id;form.elements.label.value=result.label;form.elements.expected_head.value=result.head??'';touch(form);
    if(changed&&form.elements.operation.value===automaticOperations.get(form))newOperation(form.id);
  }
  await versions('0');
}
function provenanceLabel(row){
  const origin=row.body?.origin;
  if(!origin||typeof origin!=='object'||Array.isArray(origin))return '';
  return typeof origin.url==='string'&&origin.url?origin.url:typeof origin.name==='string'?origin.name:'';
}
async function versions(offset){
  const source=state.source,epoch=state.epoch;if(!source||offset===null||offset===undefined)return;
  const selected=claimRead('versions');state.versionNext=null;$('#versions-next').disabled=true;text('#versions-table','Loading versions…');
  let result;
  try{result=await api('records',{kind:'versions',source,offset,limit:50});}catch(error){if(selected()&&source===state.source&&epoch===state.epoch)throw error;return;}
  if(!selected()||source!==state.source||epoch!==state.epoch)return;
  state.versionNext=result.next;$('#versions-next').disabled=!result.next;
  table('#versions-table',[{label:'Version',value:row=>button(shortened(row.id),()=>browse(row.id,'/'))},{label:'File bytes',value:row=>row.body.file.bytes},{label:'Original source',value:provenanceLabel}],result.items);
}
bindForm('import-form',async(data,current)=>{
  const retained=await upload(data.file);
  const result=await api('source.import',{operation:data.operation,source_id:data.source_id,label:data.label,path:retained.path,expected_head:data.expected_head.trim()||null,
    origin:{url:data.url,description:data.description,name:data.file.name}});
  if(current()){state.source=data.source_id;$('#import-form').elements.expected_head.value=result.version.id;touch($('#import-form'));await versions('0');}
  await refresh();
});
$('#refresh').addEventListener('click',()=>refresh().catch(error=>notice(error.message,true)));
$('#sources-first').addEventListener('click',()=>refresh('0').catch(error=>notice(error.message,true)));
$('#sources-next').addEventListener('click',()=>{if(state.sourceNext)refresh(state.sourceNext).catch(error=>notice(error.message,true));});
$('#versions-first').addEventListener('click',()=>{if(state.source)versions('0').catch(error=>notice(error.message,true));});
$('#versions-next').addEventListener('click',()=>{if(state.versionNext)versions(state.versionNext).catch(error=>notice(error.message,true));});
function clearObject(message){
  state.version=null;state.object=null;state.linkNext=null;state.attributeNext=null;claimRead('object');claimRead('attributes');claimRead('attribute-value');
  text('#object-title','Selected object');text('#object-summary',message);text('#datatype','');text('#object-json','');text('#attribute-value','');
  $('#links-table').replaceChildren();$('#attributes-table').replaceChildren();updateObjectControls();
}
async function browse(version,path,offset='0'){
  show('array');clearObject('Loading the selected object…');
  const epoch=state.epoch,form=$('#browse-form');form.elements.version.value=version;form.elements.path.value=path;touch(form);
  const draft=epochs.get(form),selected=claimRead('object'),current=()=>selected()&&epoch===state.epoch&&epochs.get(form)===draft;
  let object;
  try{object=await api('inspect',{version,path,offset,limit:50});}catch(error){if(current()){text('#object-summary','Object could not be loaded. Inspect the selected path again.');throw error;}return;}
  if(!current())return;
  state.version=version;state.object=object;state.linkNext=object.links?.next??null;state.attributeNext=object.attributes.next;
  text('#object-title',object.path);text('#object-summary',object.kind+' · source version '+version+' · object '+object.objectAddress+(object.shape!==undefined?' · shape '+JSON.stringify(object.shape):''));
  text('#object-json',object);text('#datatype',object.dtype?JSON.stringify(object.dtype,null,2):'Group: choose a child dataset to inspect values.');
  table('#links-table',[{label:'Name',value:row=>row.link==='hard'?button(row.name,()=>browse(version,row.path)):row.name},{label:'Kind',value:row=>row.kind??row.link},{label:'Shape / target',value:row=>row.shape!==undefined?JSON.stringify(row.shape):row.target??''}],object.links?.items??[]);
  renderAttributes(object.attributes.items,version,object.path);updateObjectControls();
}
function renderAttributes(items,version,path){
  claimRead('attribute-value');text('#attribute-value','');
  table('#attributes-table',[
    {label:'Attribute',value:row=>button(row.name,async()=>{
      const epoch=state.epoch,selected=claimRead('attribute-value');
      const current=()=>selected()&&epoch===state.epoch&&state.version===version&&state.object?.path===path;
      text('#attribute-value','Loading '+row.name+'…');let value;
      try{value=await api('attributes',{version,path,name:row.name});}catch(error){if(current())throw error;return;}
      if(current())text('#attribute-value',value);
    })},
    {label:'Shape',value:row=>JSON.stringify(row.shape)},{label:'Type',value:row=>row.dtype.numpy}
  ],items);
}
bindForm('browse-form',async data=>browse(data.version,data.path));
$('#links-next').addEventListener('click',()=>{if(state.object&&state.linkNext)browse(state.version,state.object.path,state.linkNext).catch(error=>notice(error.message,true));});
$('#object-parent').addEventListener('click',()=>{if(state.object){const parts=state.object.path.split('/');parts.pop();browse(state.version,parts.join('/')||'/').catch(error=>notice(error.message,true));}});
$('#attributes-next').addEventListener('click',async()=>{
  if(!state.object||!state.attributeNext)return;
  const epoch=state.epoch,version=state.version,path=state.object.path,offset=state.attributeNext,selected=claimRead('attributes');
  const current=()=>selected()&&epoch===state.epoch&&state.version===version&&state.object?.path===path;
  state.attributeNext=null;$('#attributes-next').disabled=true;claimRead('attribute-value');text('#attribute-value','');text('#attributes-table','Loading attributes…');
  try{
    const value=await api('attributes',{version,path,offset,limit:50});if(!current())return;
    state.attributeNext=value.next;renderAttributes(value.items,version,path);updateObjectControls();
  }catch(error){if(current())notice(error.message,true);}
});
$('#select-object').addEventListener('click',()=>{
  if(state.object?.kind!=='dataset')return;
  const form=$('#selection-form');form.elements.version.value=state.version;form.elements.dataset.value=state.object.path;
  form.elements.axes.value=state.object.shape===null?'null':JSON.stringify(state.object.shape.map(size=>({start:'0',count:size,stride:'1',block:'1'})),null,2);
  form.elements.fields.value='';touch(form);newOperation(form.id);show('selections');
});
function selectExtraction(ident,detail){
  const form=$('#extract-form'),previous=form.elements.selection_id.value;
  changeOperationTarget(form,previous,ident);form.elements.selection_id.value=ident;touch(form);text('#selection-detail',detail);
}
bindForm('selection-form',async(data,current)=>{
  const destination=$('#extract-form'),draft=epochs.get(destination),selection={dataset:data.dataset};
  if(data.axes.trim())selection.axes=parseJson(data.axes,{axisIntegers:true});if(data.fields.trim())selection.fields=parseJson(data.fields);
  const result=await api('selection.save',{operation:data.operation,version:data.version,selection});
  if(current()&&epochs.get(destination)===draft)selectExtraction(result.id,result);
  await refreshCollection('selections');
});
bindForm('extract-form',async(data,current)=>{
  const destination=$('#result-form'),draft=epochs.get(destination);
  const result=await api('selection.extract',{operation:data.operation,selection_id:data.selection_id});
  if(current()&&epochs.get(destination)===draft)await openEdition(result.id);
  await refresh();
});
async function refreshCollection(kind,offset=state.offsets[kind]??'0'){
  if(offset===null)return;
  const epoch=state.epoch,selected=claimRead('collection:'+kind);state.offsets[kind]=offset;state.next[kind]=null;$('#'+kind+'-next').disabled=true;text('#'+kind+'-table','Loading records…');
  let result;
  try{result=await api('records',{kind,offset,limit:50});}catch(error){if(selected()&&epoch===state.epoch)throw error;return;}
  if(!selected()||epoch!==state.epoch)return;
  state.next[kind]=result.next;$('#'+kind+'-next').disabled=!result.next;
  if(kind==='selections')table('#selections-table',[{label:'Selection',value:row=>button(shortened(row.id),()=>selectExtraction(row.id,row.body))},{label:'Dataset',value:row=>row.body.selection.dataset},{label:'Elements',value:row=>row.body.selection.elements}],result.items);
  else if(kind==='editions')table('#editions-table',[{label:'Edition',value:row=>button(shortened(row.id),()=>openEdition(row.id))},{label:'Dataset',value:row=>row.body.selection.dataset},{label:'Rows',value:row=>row.body.array.rows}],result.items);
  else table('#operations-table',[{label:'Operation',value:row=>button(row.id,()=>readOperation(row.id))},{label:'Action',value:row=>row.action},{label:'State',value:row=>row.state}],result.items);
}
for(const kind of ['selections','editions','operations']){
  $('#'+kind+'-first').addEventListener('click',()=>refreshCollection(kind,'0').catch(error=>notice(error.message,true)));
  $('#'+kind+'-next').addEventListener('click',()=>{if(state.next[kind])refreshCollection(kind,state.next[kind]).catch(error=>notice(error.message,true));});
}
function clearEdition(message){
  state.edition=null;state.valuesNext=null;claimRead('edition');
  text('#result-summary',message);$('#value-table').replaceChildren();$('#member-downloads').replaceChildren();$('#delivery-result').replaceChildren();text('#query-result','');
  updateEditionControls();
}
async function openEdition(edition,offset='0'){
  show('results');clearEdition('Loading the selected edition…');
  const epoch=state.epoch,form=$('#result-form'),publisher=$('#publisher-form'),exportForm=$('#export-form');
  form.elements.edition.value=edition;touch(form);
  const draft=epochs.get(form),publisherDraft=epochs.get(publisher),exportDraft=epochs.get(exportForm),selected=claimRead('edition');
  const current=()=>selected()&&epoch===state.epoch&&epochs.get(form)===draft;let page;
  try{page=await api('result.page',{edition,offset,limit:25});}catch(error){if(current()){text('#result-summary','Edition could not be loaded. Open its exact ID again.');throw error;}return;}
  if(!current())return;
  if(page.editionId!==edition)throw new Error('The returned values belong to another edition.');
  const previous=state.lastEdition;
  state.edition=edition;state.lastEdition=edition;state.valuesNext=page.next;
  if(epochs.get(exportForm)===exportDraft)changeOperationTarget(exportForm,previous,edition);
  if(epochs.get(publisher)===publisherDraft&&(!publisher.elements.edition.value||publisher.elements.edition.value===state.publisherAutoEdition)){
    if(publisher.elements.edition.value!==edition){publisher.elements.edition.value=edition;touch(publisher);}
    state.publisherAutoEdition=edition;
  }
  text('#result-summary','Edition '+edition+' · shape '+JSON.stringify(page.shape)+' · '+page.total+' exact elements · source version '+page.sourceVersion);
  table('#value-table',[{label:'Row',value:row=>row.row},{label:'Coordinates',value:row=>JSON.stringify(row.coordinates)},{label:'Typed value',value:row=>JSON.stringify(row.value)}],page.rows);
  const downloads=$('#member-downloads');
  for(const name of ['values.jsonl','dataset.csv','dataset.json','array.json','edition.json','source.h5'])downloads.append(button(name,()=>download(new URLSearchParams({edition,name}),name)));
  updateEditionControls();
}
bindForm('result-form',async data=>openEdition(data.edition));
$('#values-first').addEventListener('click',()=>{if(state.edition)openEdition(state.edition).catch(error=>notice(error.message,true));});
$('#values-next').addEventListener('click',()=>{if(state.edition&&state.valuesNext)openEdition(state.edition,state.valuesNext).catch(error=>notice(error.message,true));});
bindForm('query-form',async(data,current)=>{
  const edition=state.edition;if(!edition)throw new Error('Open an edition and wait for its values before querying it.');
  const result=await api('dataset.query',{edition,query:data.query});if(current()&&state.edition===edition)text('#query-result',result);
});
async function download(query,fallback){
  const result=await fetch('/api/artifact?'+query,{headers:{authorization:'Bearer '+token}});
  if(!result.ok){const error=await result.json();throw new Error(error.message??error.error);}
  const disposition=result.headers.get('content-disposition')??'',match=/filename="([^"\r\n/\\]+)"/i.exec(disposition);
  const name=match?.[1]??fallback??'download',blob=await result.blob(),url=URL.createObjectURL(blob),a=document.createElement('a');
  a.href=url;a.download=name;document.body.append(a);
  try{a.click();}finally{a.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);}
}
bindForm('export-form',async(data,current)=>{
  const edition=state.edition;if(!edition)throw new Error('Open an edition and wait for its values before exporting it.');
  const result=await api('edition.export',{operation:data.operation,edition});
  if(current()&&state.edition===edition){
    const root=$('#delivery-result');root.replaceChildren();const p=document.createElement('p');p.className='mono';
    p.textContent='Edition '+edition+' · '+result.archive.bytes+' bytes · SHA-256 '+result.archive.sha256;
    root.append(p,button('Download complete packet',()=>download(new URLSearchParams({delivery:data.operation}),data.operation+'.hdf5.zip')));
  }
});
bindForm('receive-form',async(data,current)=>{
  const retained=await upload(data.file,'packet',data.expected_sha);
  const result=await api('edition.receive',{operation:data.operation,archive_path:retained.path,expected_sha:data.expected_sha});
  if(current())text('#receive-result',result);await refresh();
});
function clearOperation(message){
  state.operation=null;text('#operation-detail','');text('#operation-state',message);updateOperationControls();
}
function operationSummary(operation){
  if(operation.state==='completed')return 'This operation is completed. Its retained result can be read or reopened with the same ID.';
  if(operation.state==='cancelled')return 'Cancellation is recorded for this operation. Inspect its retained result and error details.';
  if(operation.commitStarted||operation.state==='committing')return 'Adoption has begun for this operation. Cancellation cannot undo it, including after an interruption. Read or resume this same saved request to resolve its result.';
  if(operation.state==='interrupted')return 'This operation was interrupted. Resume its saved request with the same ID; its original input paths remain attached.';
  return 'Saved operation state: '+operation.state+'. Cancellation may be requested before adoption begins.';
}
function beginOperation(ident,message){
  if(!ident)throw new Error('Enter the saved operation ID.');
  show('operations');const form=$('#operation-form');form.elements.ident.value=ident;touch(form);
  const view=++state.operationView,epoch=state.epoch,draft=epochs.get(form);
  clearOperation(message);
  return()=>view===state.operationView&&epoch===state.epoch&&epochs.get(form)===draft&&form.elements.ident.value===ident;
}
function renderOperation(result,current){
  if(!current())return;
  state.operation=result;text('#operation-detail',result);text('#operation-state',operationSummary(result));updateOperationControls();
}
async function readOperation(ident){
  const current=beginOperation(ident,'Reading this saved operation…');let result;
  try{result=await api('operation.get',{ident});}catch(error){if(current()){text('#operation-state','Operation could not be read. Keep this ID and read it again.');throw error;}return;}
  renderOperation(result,current);return result;
}
bindForm('operation-form',async data=>readOperation(data.ident));
$('#last-operation').addEventListener('click',()=>{if(state.lastOperation)readOperation(state.lastOperation).catch(error=>notice(error.message,true));});
$('#resume-operation').addEventListener('click',async()=>{
  const control=$('#resume-operation');if(busyControls.has(control))return;
  busyControls.add(control);updateOperationControls();const report=requestNotice('Resuming the saved original request…');let current=()=>true;
  try{
    const ident=$('#operation-form').elements.ident.value;current=beginOperation(ident,'Resuming this saved request…');
    await api('operation.resume',{ident});if(!current())return;
    const result=await api('operation.get',{ident});renderOperation(result,current);if(current())report(operationSummary(result));
  }catch(error){if(current())report(error.message,true);}
  finally{busyControls.delete(control);updateOperationControls();}
});
$('#cancel-operation').addEventListener('click',async()=>{
  const control=$('#cancel-operation');if(busyControls.has(control))return;
  busyControls.add(control);updateOperationControls();const report=requestNotice('Requesting cancellation for the selected operation…');let current=()=>true;
  try{
    const operation=$('#operation-form').elements.ident.value;current=beginOperation(operation,'Requesting cancellation for this operation…');
    const result=await api('operation.cancel',{operation});renderOperation(result,current);if(current())report(operationSummary(result));
  }catch(error){if(current())report(error.message,true);}
  finally{busyControls.delete(control);updateOperationControls();}
});
bindForm('publisher-form',async(data,current)=>{
  const selected=claimRead('publisher-state');
  const result=await api('publisher.prepare',{edition:data.edition,payment:parseJson(data.payment),origin:data.origin,path:data.path});
  if(current()&&selected())text('#publisher-state',result);
});
$('#publisher-refresh').addEventListener('click',async()=>{
  const epoch=state.epoch,selected=claimRead('publisher-state'),report=requestNotice('Reading publisher state…');
  try{const result=await api('publisher.state');if(selected()&&epoch===state.epoch){text('#publisher-state',result);report('Publisher state returned. Review its retained release and customer state.');}}
  catch(error){if(selected()&&epoch===state.epoch)report(error.message,true);}
});
bindForm('publisher-action-form',async(data,current)=>{
  const result=await api('publisher.action',{action:data.action,payload:parseJson(data.payload)});if(current())text('#publisher-action-result',result);
});
bindForm('publisher-download-form',async data=>download(new URLSearchParams({publisherKind:data.kind,publisherId:data.id})));
try{state.lastOperation=localStorage.getItem('hdf5-last-operation')??null;}catch{}
$('#operation-form').elements.ident.value=state.lastOperation??'';
clearObject('Choose a source version and inspect its path.');clearEdition('Open an edition to inspect its exact values.');clearOperation('Read a saved operation to inspect its state.');
$('#versions-next').disabled=true;
for(const kind of ['selections','editions','operations'])$('#'+kind+'-next').disabled=true;
const opened=requestNotice('Opening the selected workspace…');
refresh().then(()=>opened('Workspace open. Choose a retained source or import its original file.')).catch(error=>opened(error.message,true));
