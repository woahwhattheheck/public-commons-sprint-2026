'use strict';
// MIT. Same-origin operator controls, with original request IDs retained before dispatch.
const $=id=>document.getElementById(id);
let token=location.hash.slice(1),state=null,manifest=null,publication=null,rowPage=null,offset=0,localPending=null,storageKey=null,activeTab='sources',refreshing=null;
const tokenKey='starforge-gdelt-token:'+location.origin;
if(token){sessionStorage.setItem(tokenKey,token);if(sessionStorage.getItem(tokenKey)!==token)throw Error('This browser could not retain the private session.');history.replaceState(null,'',location.pathname);}
else token=sessionStorage.getItem(tokenKey)??'';
function fail(message){throw Error(message);}
function value(id){return $(id).value.trim();}
function json(id,fallback){const text=value(id);return text?JSON.parse(text):fallback;}
function id(prefix){return prefix+'-'+crypto.randomUUID();}
function message(text,error=false){$('message').textContent=text;$('message').classList.toggle('error',error);}
function show(target,data){const node=$(target);node.replaceChildren();const pre=document.createElement('pre');pre.textContent=typeof data==='string'?data:JSON.stringify(data,null,2);node.append(pre);}
function result(data,target){show('rawResult',data);if(target)show(target,data);return data;}
function selectedCaptures(){return [...$('captures').selectedOptions].map(option=>option.value);}
function selectOptions(target,entries,selected){
  const node=$(target),previous=selected??(node.multiple?[...node.selectedOptions].map(option=>option.value):[node.value]);
  node.replaceChildren();for(const item of entries){const option=document.createElement('option');option.value=item.value;option.textContent=item.label;option.selected=previous.includes(item.value);node.append(option);}
  if(!node.multiple&&node.selectedIndex<0&&node.options.length)node.selectedIndex=0;
}
function table(target,rows,fields){
  const root=$(target);root.replaceChildren();if(!rows.length){root.textContent='No rows in this selection.';return;}
  fields??=Object.keys(rows[0]);const t=document.createElement('table'),head=document.createElement('thead'),tr=document.createElement('tr');
  for(const field of fields){const th=document.createElement('th');th.scope='col';th.textContent=field;tr.append(th);}head.append(tr);t.append(head);
  const body=document.createElement('tbody');for(const row of rows){const r=document.createElement('tr');for(const field of fields){const cell=document.createElement('td'),v=row[field];cell.textContent=v===null?'null':typeof v==='object'?JSON.stringify(v):String(v??'');r.append(cell);}body.append(r);}t.append(body);root.append(t);
}
async function http(path,body,{binary=false}={}){
  const response=await fetch(path,{method:body===undefined?'GET':'POST',headers:{authorization:'Bearer '+token,...(body===undefined?{}:{'content-type':'application/json'})},body:body===undefined?undefined:JSON.stringify(body),cache:'no-store',redirect:'error'});
  if(!response.ok){let error;try{error=await response.json();}catch{error={message:'The original application returned HTTP '+response.status};}throw Object.assign(Error(error.message),error);}
  return binary?response:response.json();
}
const query=(kind,input={})=>http('/api/query',{kind,input});
function saved(key,value){
  const raw=JSON.stringify(value);sessionStorage.setItem(storageKey+':'+key,raw);
  if(sessionStorage.getItem(storageKey+':'+key)!==raw)fail('The browser could not retain this exact request before dispatch. Use the complete CLI import for files larger than browser session storage.');
}
function restore(key){const raw=sessionStorage.getItem(storageKey+':'+key);if(!raw)return null;try{return JSON.parse(raw);}catch{fail('The retained browser record is unreadable. Reopen the original session.');}}
function retainPending(body){if(!storageKey)fail('Open the original project first.');saved('pending',body);localPending=body;renderPending();}
function clearPending(){sessionStorage.removeItem(storageKey+':pending');localPending=null;renderPending();}
function preserveDraft(){
  if(!storageKey)return;
  const fields=['captureOperation','reviewOperation','publishOperation','datasetId','intentId','table','fields','policy','reviewName','reviewNote','origin','route','payment','datasetKind','datasetQuery','maxPages','maxAtomic','previewQuery','previewKind','singleQuery'];
  saved('draft',Object.fromEntries(fields.map(name=>[name,$(name).value])));
}
function restoreDraft(){
  const draft=restore('draft');if(draft)for(const [name,text]of Object.entries(draft))if($(name)&&typeof text==='string')$(name).value=text;
  for(const [name,prefix]of[['captureOperation','capture'],['reviewOperation','review'],['publishOperation','publish'],['datasetId','dataset'],['intentId','request']])if(!value(name))$(name).value=id(prefix);
  manifest=restore('manifest');if(manifest)renderManifest();
  localPending=restore('pending');renderPending();
}
function renderPending(){
  const original=state?.project.pending,pending=localPending??original;
  $('pendingPanel').hidden=!pending;if(pending)show('pendingDetail',{browserRequest:localPending,originalProjectOperation:original});
  $('discardLocal').disabled=!localPending||Boolean(state?.busy);
}
async function refresh(){
  if(refreshing)return refreshing;
  refreshing=(async()=>{
    const next=await query('state');
    if(state&&state.project.id!==next.project.id)fail('This browser origin now serves another project. Open its current private connection.');
    const first=!state;state=next;
    if(first){storageKey='starforge-gdelt:'+state.project.id;restoreDraft();}
    $('projectTitle').textContent=state.project.title;$('revision').textContent='Revision '+state.project.revision;
    $('connection').textContent=state.buyerConfigured?'Original buyer configured':'Source and merchant workspace';
    const captures=state.project.captures.map(c=>({value:c.id,label:c.batch+' · '+c.counts.events+' events / '+c.counts.mentions+' mentions'}));
    const current=selectedCaptures();selectOptions('captures',captures,current.length?current:state.project.selectedCapture?[state.project.selectedCapture]:[]);
    selectOptions('before',captures);selectOptions('after',captures);
    if(first&&captures.length>1)$('after').value=captures.at(-1).value;
    const reviews=state.project.reviews.map(r=>({value:r.id,label:r.name+' · '+r.rowCount+' rows · '+r.id.slice(0,12)}));
    selectOptions('reviews',reviews,state.project.selectedReview&&!value('reviews')?[state.project.selectedReview]:undefined);
    const editions=state.project.publications.map(p=>({value:p.id,label:p.resource+' · '+p.id.slice(0,12)}));
    selectOptions('publications',editions);selectOptions('customerPublication',editions);
    $('busy').hidden=!state.busy;if(state.busy)$('busy').querySelector('span').textContent=state.busy.action+' · '+state.busy.id+' · started '+state.busy.startedAt;
    show('merchantFacts',state.merchant??'Merchant stopped.');
    table('historyRows',state.project.operations.slice().reverse().map(o=>({id:o.id,action:o.kind,completed:o.completedAt,result:o.result})),['id','action','completed','result']);
    renderPending();
    if(first&&!value('fields'))await fields(true);
    return state;
  })().finally(()=>{refreshing=null;});return refreshing;
}
async function act(body,target){
  preserveDraft();
  if(localPending&&JSON.stringify(localPending)!==JSON.stringify(body))fail('A saved browser request is awaiting recovery. Resume it from History, or select Edit local draft after checking the original operation.');
  retainPending(body);message('Running '+body.action+' with its original operation…');
  try{
    const out=await http('/api/action',body);clearPending();result(out,target);await refresh();
    message(body.action+' completed.');return out;
  }catch(error){try{await refresh();}catch{}throw error;}
}
const projectAction=(action,body)=>({action,expectedRevision:state.project.revision,...body});
function renderManifest(){
  const batches=manifest.availableBatches??manifest.batches??[];
  selectOptions('batch',batches.map(batch=>({value:typeof batch==='string'?batch:batch.batch,label:typeof batch==='string'?batch:batch.batch})));
  $('manifestInfo').textContent=(manifest.manifest??manifest).url+' · read '+(manifest.manifest??manifest).receivedAt;
}
async function discover(history){
  const out=await act({action:'discover',history},'sourceFacts');manifest=out;saved('manifest',manifest);renderManifest();
}
function policy(){
  const extra=json('policy',{});if(extra===null||Array.isArray(extra)||typeof extra!=='object')fail('Projection settings must be a JSON object.');
  return {...extra,table:value('table'),fields:value('fields').split(',').map(x=>x.trim()).filter(Boolean)};
}
async function fields(defaults=false){
  const out=await query('fields',{table:value('table')});
  table('fieldMeanings',out.fields,['name','type','meaning']);
  if(defaults)$('fields').value=out.fields.map(field=>field.name).join(', ');
  preserveDraft();return out;
}
async function rows(reset=false){
  if(reset)offset=0;
  const out=await query('rows',{captureIds:selectedCaptures(),policy:policy(),offset,limit:100});rowPage=out;
  $('rowsTitle').textContent=out.total.toLocaleString()+' selected rows · '+out.sourceRows.toLocaleString()+' source rows · offset '+out.offset;
  table('rows',out.rows,out.policy.fields);$('previousRows').disabled=offset===0;$('nextRows').disabled=offset+out.rows.length>=out.total;
  return result(out);
}
async function publicationView(source='customerPublication'){
  const publicationId=value(source);if(!publicationId)return;
  publication=await query('publication',{publicationId});
  const savedDatasets=publication.customers.filter(c=>c.kind==='dataset').map(c=>({value:c.id,label:c.id+' · '+c.product}));
  selectOptions('datasets',savedDatasets);
  const assets=publication.plan.downloads??[];
  selectOptions('asset',[{value:'',label:'Dataset page'},...assets.map(a=>({value:a.path,label:a.path}))]);
  result(publication,source==='publications'?'merchantFacts':'datasetPlan');
  return publication;
}
function customerInput(){return{publicationId:value('customerPublication'),id:value('datasets')||value('datasetId')};}
async function download(kind,input={}){
  const response=await http('/api/download',{kind,input},{binary:true}),bytes=await response.arrayBuffer();
  const expected=response.headers.get('x-content-sha256');
  if(!expected||!/^[a-f0-9]{64}$/.test(expected))fail('The original download is missing its complete SHA256.');
  const digest=[...new Uint8Array(await crypto.subtle.digest('SHA-256',bytes))].map(x=>x.toString(16).padStart(2,'0')).join('');
  if(digest!==expected)fail('The complete downloaded file differs from its original identity.');
  const name=/filename="([^"]+)"/.exec(response.headers.get('content-disposition')??'')?.[1]??'gdelt-download';
  const blob=new Blob([bytes],{type:response.headers.get('content-type')??'application/octet-stream'}),url=URL.createObjectURL(blob),a=document.createElement('a');
  a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);
  message('Downloaded '+name+' · '+bytes.byteLength.toLocaleString()+' bytes · SHA256 '+digest);
}
function click(name,work){$(name).addEventListener('click',()=>Promise.resolve().then(work).catch(error=>message((error.code?error.code+': ':'')+error.message+(error.retryAt?' · retry after '+error.retryAt:''),true)));}
function change(name,work){$(name).addEventListener('change',()=>Promise.resolve().then(work).catch(error=>message(error.message,true)));}
function newOperation(name,prefix){
  if(state?.busy)fail('The current original action is still running.');
  if(localPending)fail('Inspect or resume the saved original request in History before choosing another operation. Edit local draft explicitly when you intend to replace it.');
  $(name).value=id(prefix);preserveDraft();message('New explicit '+prefix+' operation selected.');
}
click('refresh',async()=>{await refresh();message('Original project state refreshed.');});
click('discover',()=>discover(false));click('historyManifest',()=>discover(true));
click('capture',()=>{if(!manifest||!value('batch'))fail('Read and select an official source update first.');return act(projectAction('capture',{id:value('captureOperation'),batch:value('batch'),manifest:manifest.manifest??manifest}),'sourceFacts');});
click('newCapture',()=>newOperation('captureOperation','capture'));
click('importCapture',async()=>{const file=$('captureFile').files[0];if(!file)fail('Select the complete original capture JSON.');const capture=JSON.parse(await file.text());return act(projectAction('import',{id:value('captureOperation'),capture}),'sourceFacts');});
click('inspectSource',async()=>{const captureId=selectedCaptures()[0];if(!captureId)fail('Select a retained capture.');result(await query('source-summary',{captureId}),'sourceFacts');});
click('downloadSource',()=>download('source',{captureId:selectedCaptures()[0]}));
click('schema',()=>fields(false));change('table',()=>fields(true));click('loadRows',()=>rows(true));
click('previousRows',()=>{offset=Math.max(0,offset-100);return rows();});click('nextRows',()=>{if(rowPage&&offset+100<rowPage.total)offset+=100;return rows();});
click('saveReview',()=>act(projectAction('review',{id:value('reviewOperation'),captureIds:selectedCaptures(),policy:policy(),note:$('reviewNote').value,name:value('reviewName')}),'sourceFacts'));
click('newReview',()=>newOperation('reviewOperation','review'));
click('compare',async()=>result(await query('compare',{before:value('before'),after:value('after')}),'comparison'));
click('downloadComparison',()=>download('comparison',{before:value('before'),after:value('after')}));
click('publish',()=>act(projectAction('publish',{id:value('publishOperation'),reviewId:value('reviews'),origin:value('origin'),path:value('route'),payment:json('payment',null)}),'merchantFacts'));
click('newPublication',()=>newOperation('publishOperation','publish'));
click('publication',()=>publicationView('publications'));
click('merchantStart',()=>act({action:'merchant-start',publicationId:value('publications')},'merchantFacts'));
click('merchantStop',()=>act({action:'merchant-stop',publicationId:value('publications')},'merchantFacts'));
click('preview',async()=>result(await query('preview',{publicationId:value('publications'),kind:value('previewKind'),query:value('previewQuery')}),'previewResult'));
change('customerPublication',()=>publicationView());
click('datasetPrepare',async()=>{
  const out=await act({action:'dataset-prepare',publicationId:value('customerPublication'),id:value('datasetId'),kind:value('datasetKind'),
    query:value('datasetQuery'),maxPages:Number(value('maxPages')),maxTotalAtomic:value('maxAtomic')},'datasetPlan');
  await publicationView();$('datasets').value=out.id;return out;
});
click('datasetNew',()=>newOperation('datasetId','dataset'));
for(const button of document.querySelectorAll('[data-customer]'))button.addEventListener('click',async()=>{
  try{const out=await act({action:button.dataset.customer,...customerInput()},'customerResult');
    if(button.dataset.customer==='customer-open'&&out.url){const link=document.createElement('a');link.href=out.url;link.target='_blank';link.rel='noreferrer';link.textContent='Open received event desk';$('customerResult').append(link);}
  }catch(error){message((error.code?error.code+': ':'')+error.message,true);}
});
click('downloadDataset',()=>download('dataset',{...customerInput(),file:value('deliveredFile')}));
click('singleNew',()=>newOperation('intentId','request'));
click('singlePrepare',()=>act({action:'prepare',publicationId:value('customerPublication'),intentId:value('intentId'),
  query:value('asset')?'':value('singleQuery'),kind:'rows',...(value('asset')?{file:value('asset')}:{})},'singleResult'));
click('singleBuy',()=>act({action:'buy',publicationId:value('customerPublication'),intentId:value('intentId')},'singleResult'));
click('singleRecover',()=>act({action:'recover',publicationId:value('customerPublication'),intentId:value('intentId')},'singleResult'));
click('singleDownload',()=>download('customer',{publicationId:value('customerPublication'),intentId:value('intentId')}));
click('downloadProject',()=>download('project'));
click('receiveProject',async()=>{const file=$('projectFile').files[0];if(!file)fail('Select the complete original project bundle.');return act({action:'project-receive',bundle:JSON.parse(await file.text())},'projectReceiving');});
click('resumePending',async()=>{
  let body=localPending;const pending=state.project.pending;
  if(!body&&pending){
    if(pending.kind==='import')fail('Select the same complete source file to resume this import.');
    body={action:pending.kind,id:pending.id,expectedRevision:pending.expectedRevision,...pending.payload};
  }
  if(!body)fail('No retained action awaits continuation.');
  return act(body);
});
click('discardLocal',async()=>{await refresh();if(state.busy)fail('The current original action is still running.');clearPending();message('Local draft reopened. The original project history and any retained source operation remain available.');});
click('abandon',async()=>{
  const original=state.project.pending;if(!original)fail('The original project has no unfinished mutation.');
  const note=value('abandonNote');if(!note)fail('Record why this retained operation is being abandoned.');
  if(localPending&&localPending.id!==original.id)fail('A different original browser request is retained. Inspect it before replacing that local draft.');
  clearPending();return act(projectAction('abandon',{id:id('abandon'),pendingId:original.id,note}));
});
click('cancel',async()=>{if(!state.busy)fail('No original action is running.');result(await http('/api/cancel',{id:state.busy.id}));await refresh();message('Cancellation requested for the original action; its existing source and buyer records remain available.');});
for(const button of document.querySelectorAll('[data-tab]'))button.addEventListener('click',()=>{
  activeTab=button.dataset.tab;for(const node of document.querySelectorAll('.panel'))node.hidden=node.id!==activeTab;
  for(const tab of document.querySelectorAll('[data-tab]'))if(tab===button)tab.setAttribute('aria-current','page');else tab.removeAttribute('aria-current');
  if(activeTab==='customer')publicationView().catch(error=>message(error.message,true));
});
for(const element of document.querySelectorAll('input:not([type=file]),textarea,select'))element.addEventListener('change',()=>{try{preserveDraft();}catch(error){message(error.message,true);}});
setInterval(()=>{if(state?.busy)refresh().catch(error=>message(error.message,true));},2000);
(async()=>{if(!/^[a-f0-9]{64}$/.test(token))fail('Open the original private URL from the workspace startup.');await refresh();message('Original project ready.');})().catch(error=>message(error.message,true));
