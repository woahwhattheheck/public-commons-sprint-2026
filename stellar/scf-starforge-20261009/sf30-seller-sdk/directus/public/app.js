'use strict';
const $=id=>document.getElementById(id);
const parse=(text,label='JSON')=>{try{const value=JSON.parse(text);if(!value||typeof value!=='object'||Array.isArray(value))throw new Error();return value;}catch{throw new Error(label+' must be a JSON object.');}};
const formValue=id=>Object.fromEntries(new FormData($(id)));
const printable=value=>typeof value==='string'?value:JSON.stringify(value,null,2);
const lines=text=>String(text??'').split(/\r?\n/).map(x=>x.trim()).filter(Boolean);
const requestId=kind=>'directus-'+kind+'-'+crypto.randomUUID();
let state=null,sourceId=null,sourceOffset=0,sourceTotal=0,selectedEdition=null,pollTimer=null,nativeRequest=null;
const sourceDocuments=new Map();
function notice(message){$('notice').textContent=message??'';}
function jsonView(id,value){$(id).textContent=JSON.stringify(value,null,2);}
function button(label,run){const node=document.createElement('button');node.type='button';node.textContent=label;node.addEventListener('click',()=>guard(run));return node;}
function table(target,headers,rows){
  const table=document.createElement('table'),thead=document.createElement('thead'),tr=document.createElement('tr');
  for(const name of headers){const th=document.createElement('th');th.textContent=name;tr.append(th);}thead.append(tr);table.append(thead);
  const tbody=document.createElement('tbody');
  for(const row of rows){const tr=document.createElement('tr');for(const value of row){const td=document.createElement('td');if(value instanceof Node)td.append(value);else td.textContent=value===null?'null':String(value??'');tr.append(td);}tbody.append(tr);}
  if(!rows.length){const tr=document.createElement('tr'),td=document.createElement('td');td.colSpan=headers.length;td.textContent='No retained records yet.';tr.append(td);tbody.append(tr);}
  table.append(tbody);$(target).replaceChildren(table);
}
function options(select,entries,{empty}={}){
  const old=select.value;select.replaceChildren();
  if(empty!==undefined){const option=document.createElement('option');option.value='';option.textContent=empty;select.append(option);}
  for(const [value,label] of entries){const option=document.createElement('option');option.value=value;option.textContent=label;select.append(option);}
  if(entries.some(([id])=>id===old))select.value=old;
}
function scopeHeaders(){
  if(!state)return {};
  return {'x-directus-operator':state.operator.id,'x-directus-instance':state.operator.instanceId,
    'x-directus-project':state.operator.selected,'x-directus-workspace':state.id};
}
async function api(url,{method='GET',value,raw,headers={}}={}){
  const response=await fetch(url,{method,headers:{...(url==='/api/state'?{}:scopeHeaders()),...(value===undefined?{}:{'content-type':'application/json'}),...headers},body:raw??(value===undefined?undefined:JSON.stringify(value)),cache:'no-store'});
  const data=await response.json();
  if(!response.ok){const error=new Error(data.message??data.error??'The operation failed.');error.code=data.error;error.status=response.status;throw error;}
  return data;
}
async function guard(run){
  try{return await run();}catch(error){notice((error.code?error.code+': ':'')+error.message);if(error.status===409)await refresh().catch(()=>{});}
}
function onForm(id,run){$(id).addEventListener('submit',event=>{event.preventDefault();guard(async()=>{const buttons=[...$(id).querySelectorAll('button')];buttons.forEach(b=>b.disabled=true);try{await run(formValue(id));}finally{buttons.forEach(b=>b.disabled=false);}});});}
const actor=()=>{const value=$('actor').value.trim();if(!value)throw new Error('Name the operator making this change.');return value;};
async function change(action,input){
  const key='directus-pending:'+state.id+':'+action,signature=JSON.stringify(input),old=JSON.parse(sessionStorage.getItem(key)??'null');
  if(old&&old.signature!==signature)throw new Error('Continue the original '+action+' request with its saved inputs, or inspect its operation in History before changing this form.');
  const request=old?.request??{action,...input,actor:actor(),operationId:requestId(action),expectedRevision:state.revision};
  sessionStorage.setItem(key,JSON.stringify({signature,request}));
  try{const result=await api('/api/action',{method:'POST',value:request});sessionStorage.removeItem(key);await refresh();return result;}
  catch(error){if(error.status&&error.status<500)sessionStorage.removeItem(key);throw error;}
}
async function refresh(){
  state=await api('/api/state');
  $('workspace-status').textContent=state.id+' · revision '+state.revision;
  $('activity').textContent=state.native_active?state.native_active+' native operation running':'';
  options($('project'),state.operator.projects.map(p=>[p.key,p.name]));$('project').value=state.operator.selected;
  if(document.activeElement!==$('base-url'))$('base-url').value=state.connection.baseUrl;
  $('connection-status').textContent=state.connection.configured?'Connection configured · '+(state.connection.authenticated?'token available':'token required'):'Configure the original Directus API.';
  const sourceRows=state.sources.map(s=>[s.name,s.collection??s.scope?.collection,s.item_count,s.recorded_at??s.created_at,button('Open',()=>openSource(s.id))]);
  table('source-list',['Capture','Collection','Items','Captured',''],sourceRows);
  options($('edition-source'),state.sources.map(s=>[s.id,s.name+' · '+s.item_count+' items']));
  const editions=state.editions.map(e=>[e.id,e.name+' · '+e.row_count+' rows']);
  for(const select of document.querySelectorAll('.edition-select'))options(select,editions);
  options($('previous-edition'),editions,{empty:'First edition'});
  table('edition-list',['Edition','Rows','Latest review',''],state.editions.map(e=>{
    const review=state.reviews.filter(r=>r.edition_id===e.id).at(-1);
    return [e.name,e.row_count,review?.decision??'Awaiting review',button('Open',()=>openEdition(e.id))];
  }));
  const native=state['native-events']??[],groups=new Map();
  for(const e of native)groups.set(e.operation_id,e);
  const history=[...groups.values()].map(e=>[e.created_at,e.action,e.phase,e.operation_id,button('Read',async()=>jsonView('history-detail',await api('/api/native-history?id='+encodeURIComponent(e.operation_id))))]);
  for(const r of state.reviews)history.push([r.created_at,'Edition review',r.decision,r.id,button('Read',async()=>jsonView('history-detail',await api('/api/record?kind=reviews&id='+encodeURIComponent(r.id))))]);
  for(const p of state.publications)history.push([p.created_at,'Publication',p.publication?.status,p.id,button('Read',async()=>jsonView('history-detail',await api('/api/record?kind=publications&id='+encodeURIComponent(p.id))))]);
  history.sort((a,b)=>String(b[0]).localeCompare(String(a[0])));table('history-list',['Time','Operation','State','Original ID',''],history);
  await loadFields();
}
async function sourceDocument(id){
  if(!sourceDocuments.has(id))sourceDocuments.set(id,await api('/api/record?kind=sources&id='+encodeURIComponent(id)+'&limit=20'));
  return sourceDocuments.get(id);
}
async function loadFields(){
  const id=$('edition-source').value;if(!id){$('field-choices').replaceChildren();return;}
  const source=await sourceDocument(id),previous=new Set([...$('field-choices').querySelectorAll('input:checked')].map(n=>n.value));
  const same=$('field-choices').dataset.source===id,fragment=document.createDocumentFragment();
  for(const field of source.native_schema.fields){
    const label=document.createElement('label'),input=document.createElement('input'),text=document.createElement('span');
    input.type='checkbox';input.name='metadataFields';input.value=field.field;input.checked=same?previous.has(field.field):field.schema?.is_primary_key===true;
    text.textContent=field.field+' · '+field.type+(field.schema?.is_primary_key?' · primary key':'');label.append(input,text);fragment.append(label);
  }
  $('field-choices').replaceChildren(fragment);$('field-choices').dataset.source=id;
}
async function openSource(id){sourceId=id;sourceOffset=0;$('source-detail').hidden=false;$('edition-source').value=id;await loadFields();await itemPage();}
async function itemPage(){
  if(!sourceId)return;const source=await sourceDocument(sourceId),search=$('item-search').value;
  const page=await api('/api/items?id='+encodeURIComponent(sourceId)+'&offset='+sourceOffset+'&limit=20&search='+encodeURIComponent(search));sourceTotal=page.total;
  $('source-title').textContent=source.name;$('source-scope').textContent=source.base_url+' · '+source.scope.collection+' · '+source.sha256;
  $('item-page').textContent=(page.total?sourceOffset+1:0)+'–'+(sourceOffset+page.items.length)+' of '+page.total;
  $('previous-items').disabled=sourceOffset===0;$('next-items').disabled=sourceOffset+page.items.length>=page.total;
  const fields=source.native_schema.fields.slice(0,5).map(f=>f.field);
  table('items',['Key',...fields,''],page.items.map(item=>[item.key,...fields.map(f=>{const v=item.values?.[f];return v?.state==='value'?v.json:v?.state??'missing';}),
    button('Original item',()=>{jsonView('history-detail',item);$('history').scrollIntoView({behavior:'smooth'});})]));
}
async function openEdition(id){
  const edition=await api('/api/record?kind=editions&id='+encodeURIComponent(id)+'&limit=20');selectedEdition=edition;
  $('edition-detail').hidden=false;$('edition-title').textContent=edition.name;$('edition-identity').textContent='Edition '+edition.sha256+'\nSnapshot '+edition.snapshot;
  for(const [node,kind] of [['edition-csv','dataset'],['edition-config','config'],['edition-record','editions']])$(node).href='/api/download?kind='+kind+'&id='+encodeURIComponent(id);
  table('edition-rows',edition.columns,edition.rows.map(row=>edition.columns.map(key=>row[key])));
}
function fillNativeResult(action,result){
  const native=result?.native??result;
  if(native?.versionId)for(const input of document.querySelectorAll('[data-version]'))input.value=native.versionId;
  if(action==='draft-compare'){
    if(native?.mainHash!==undefined)$('draft-promote-form').elements.mainHash.value=native.mainHash??'';
    if(native?.versionSha256)$('draft-promote-form').elements.expectedVersionSha256.value=native.versionSha256;
  }
}
async function pollNative(){
  if(!nativeRequest)return;
  try{
    const result=await api('/api/native-status?id='+encodeURIComponent(nativeRequest.input.operationId));
    $('native-status').textContent=result.operationId+' · '+result.state;
    jsonView('native-result',result.result??result.error??result);
    $('resume-native').hidden=!['failed','resumable'].includes(result.state);
    if(result.state==='running'){pollTimer=setTimeout(()=>guard(pollNative),1500);return;}
    if(result.state==='complete'){fillNativeResult(nativeRequest.action,result.result);notice('Native operation complete. Its original history is retained.');sessionStorage.removeItem('directus-native:'+state.id);await refresh();}
    else notice(result.error?.message??'Continue the original native request to finish its retained operation.');
  }catch(error){$('resume-native').hidden=false;throw error;}
}
async function nativeStart(action,input){
  input={...input,actor:actor()};
  nativeRequest={action,input};sessionStorage.setItem('directus-native:'+state.id,JSON.stringify(nativeRequest));
  clearTimeout(pollTimer);$('resume-native').hidden=true;
  const result=await api('/api/native',{method:'POST',value:{action,...input}});
  $('native-status').textContent=result.operationId+' · '+result.state;await pollNative();
}
for(const input of document.querySelectorAll('[data-operation]'))input.value=requestId(input.dataset.operation);
for(const b of document.querySelectorAll('[data-new-request]'))b.addEventListener('click',()=>{const input=$(b.dataset.newRequest).elements.operationId;input.value=requestId(input.dataset.operation);});
$('actor').value=localStorage.getItem('directus-actor')??'Directus operator';$('actor').addEventListener('change',()=>localStorage.setItem('directus-actor',$('actor').value));
$('refresh').addEventListener('click',()=>guard(refresh));
$('project').addEventListener('change',()=>guard(async()=>{clearTimeout(pollTimer);sourceDocuments.clear();sourceId=null;selectedEdition=null;state=await api('/api/select-project',{method:'POST',value:{key:$('project').value}});await refresh();}));
$('edition-source').addEventListener('change',()=>guard(loadFields));
$('previous-items').addEventListener('click',()=>guard(async()=>{sourceOffset=Math.max(0,sourceOffset-20);await itemPage();}));
$('next-items').addEventListener('click',()=>guard(async()=>{if(sourceOffset+20<sourceTotal)sourceOffset+=20;await itemPage();}));
$('item-search').addEventListener('change',()=>guard(async()=>{sourceOffset=0;await itemPage();}));
$('resume-native').addEventListener('click',()=>guard(()=>nativeStart(nativeRequest.action,nativeRequest.input)));
onForm('connection-form',async input=>{await api('/api/connection',{method:'POST',value:input});$('connection-form').elements.token.value='';notice('Connection configured.');await refresh();});
onForm('capture-form',async input=>{input.query=parse(input.query,'Native query');input.pageSize=Number(input.pageSize);if(!input.name)delete input.name;await nativeStart('capture',input);});
onForm('draft-create-form',async input=>{input.item=input.item||null;if(!input.name)delete input.name;await nativeStart('draft-create',input);});
onForm('draft-save-form',async input=>{parse(input.patchJson,'Original patch');await nativeStart('draft-save',input);});
onForm('draft-compare-form',input=>nativeStart('draft-compare',input));
onForm('draft-promote-form',async input=>{input.mainHash=input.mainHash||null;input.fields=lines(input.fields);if(!input.fields.length)delete input.fields;await nativeStart('draft-promote',input);});
onForm('edition-form',async input=>{
  const source=await sourceDocument(input.sourceId),metadataFields=[...$('field-choices').querySelectorAll('input:checked')].map(i=>i.value);
  if(metadataFields.length<1||metadataFields.length>32)throw new Error('Select 1–32 native fields.');
  const result=await change('save-edition',{name:input.name,mode:'collection',selection:[{sourceId:source.id,sourceSha256:source.sha256,collection:source.scope.collection}],
    metadataFields,rights:{attribution:input.attribution,basis:input.rights,...(input.reference?{reference:input.reference}:{})},
    ...(input.previousEditionId?{previousEditionId:input.previousEditionId}:{}),nativeOperationIds:lines(input.nativeOperationIds)});
  notice('Edition saved.');await openEdition(result.edition.id);
});
onForm('review-form',async input=>{const e=state.editions.find(e=>e.id===input.editionId);const result=await change('review-edition',{...input,editionSha256:e.sha256});notice('Review saved.');jsonView('history-detail',result);});
$('select-edition').addEventListener('click',()=>guard(async()=>{const editionId=$('review-form').elements.editionId.value,review=state.reviews.filter(r=>r.edition_id===editionId).at(-1);if(review?.decision!=='approved')throw new Error('Choose an edition with a current approved review.');await change('select-edition',{editionId,reviewId:review.id});notice('Approved edition selected.');}));
onForm('compare-editions-form',async input=>{const result=await change('compare-editions',input);jsonView('edition-comparison',await api('/api/record?kind=comparisons&id='+encodeURIComponent(result.comparison.id)));});
onForm('query-form',async input=>jsonView('query-result',await api('/api/query',{method:'POST',value:{editionId:input.editionId,query:parse(input.query,'Dataset query')}})));
onForm('merchant-form',async input=>{
  const edition=state.editions.find(e=>e.id===input.editionId),review=state.reviews.filter(r=>r.edition_id===edition.id).at(-1);
  if(review?.decision!=='approved')throw new Error('Choose a currently approved edition.');
  const result=await api('/api/merchant',{method:'POST',value:{action:'prepare',...input,editionSha256:edition.sha256,reviewId:review.id,payment:parse(input.payment,'Payment terms')}});
  for(const field of document.querySelectorAll('[data-package]'))field.value=result.directory;
  jsonView('merchant-result',result);notice('Merchant package prepared.');
});
onForm('serve-form',async input=>{const result=await api('/api/merchant',{method:'POST',value:{action:'serve',directory:input.directory,stageDirectory:input.stageDirectory,runtime:parse(input.runtime,'Runtime')}});jsonView('merchant-result',result);$('buyer-form').elements.seller.value=result.url;await refresh();});
$('stop-seller').addEventListener('click',()=>guard(async()=>{jsonView('merchant-result',await api('/api/merchant',{method:'POST',value:{action:'stop',directory:$('serve-form').elements.directory.value}}));await refresh();}));
$('publish-refresh').addEventListener('click',()=>guard(async()=>{const input=formValue('serve-form');jsonView('merchant-result',await api('/api/merchant',{method:'POST',value:{action:'publish',directory:input.directory,expectedSnapshot:input.expectedSnapshot,expectedRevision:Number(input.expectedRevision)}}));await refresh();}));
const buyerInput=()=>{const input=formValue('buyer-form');return {directory:input.directory,seller:input.seller,query:parse(input.query,'First page query')};};
onForm('buyer-form',async()=>{const result=await api('/api/buyer',{method:'POST',value:{action:'offer',...buyerInput()}});jsonView('merchant-result',result);if(result.offerSha256)$('buyer-form').elements.offerSha256.value=result.offerSha256;});
$('prepare-buyer').addEventListener('click',()=>guard(async()=>{const input=formValue('buyer-form');jsonView('merchant-result',await api('/api/buyer',{method:'POST',value:{action:'prepare',...buyerInput(),intentId:input.intentId,acceptIndex:Number(input.acceptIndex),offerSha256:input.offerSha256,destination:input.destination}}));}));
onForm('receive-buyer-form',async input=>jsonView('merchant-result',await api('/api/buyer',{method:'POST',value:{action:'receive',...input,includeSourceCaptures:$('receive-buyer-form').elements.includeSourceCaptures.checked}})));
$('inspect-delivery').addEventListener('click',()=>guard(async()=>jsonView('merchant-result',await api('/api/buyer',{method:'POST',value:{action:'inspect',directory:$('receive-buyer-form').elements.destination.value}}))));
function fileBase64(file){return new Promise((resolve,reject)=>{const reader=new FileReader();reader.onerror=()=>reject(new Error('The selected file could not be read.'));reader.onload=()=>resolve(String(reader.result).split(',')[1]);reader.readAsDataURL(file);});}
$('import-source').addEventListener('change',()=>guard(async()=>{const file=$('import-source').files[0];if(!file)return;const result=await change('import-source',{sourceBase64:await fileBase64(file)});notice('Source capture retained.');await openSource(result.source.id);}));
$('receive-project').addEventListener('change',()=>guard(async()=>{const file=$('receive-project').files[0];if(!file)return;const key='directus-receive:'+state.id,previous=JSON.parse(sessionStorage.getItem(key)??'null'),identity=file.name+':'+file.size+':'+file.lastModified;const id=previous?.identity===identity?previous.id:requestId('receive');sessionStorage.setItem(key,JSON.stringify({identity,id}));const result=await api('/api/receive',{method:'POST',raw:file,headers:{'content-type':'application/vnd.sqlite3','x-operation-id':id}});sessionStorage.removeItem(key);sourceDocuments.clear();sourceId=null;state=result.state;await refresh();notice('Complete project received and opened.');}));
guard(async()=>{await refresh();const previous=JSON.parse(sessionStorage.getItem('directus-native:'+state.id)??'null');if(previous){nativeRequest=previous;$('resume-native').hidden=false;await pollNative();}});
