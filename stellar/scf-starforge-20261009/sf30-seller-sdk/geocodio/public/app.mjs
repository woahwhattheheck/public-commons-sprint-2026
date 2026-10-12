import {createPublisherPanel} from './publisher.mjs';
const $=id=>document.getElementById(id);
const format=value=>value===null||value===undefined?'—':typeof value==='object'?JSON.stringify(value,null,2):String(value);
const node=(tag,value,className)=>{const e=document.createElement(tag);if(value!==undefined)e.textContent=format(value);if(className)e.className=className;return e;};
const count=value=>Number.isFinite(value)?value.toLocaleString('en-US'):'—';
const json=value=>JSON.stringify(value,null,2);
const facts=entries=>{const e=node('dl');for(const [k,v] of entries)e.append(node('dt',k),node('dd',v));return e;};
const button=(label,key,value)=>{const e=node('button',label);e.type='button';e.dataset[key]=value;return e;};
const detail=(label,value)=>{const e=node('details');e.append(node('summary',label),node('pre',json(value)));return e;};
let state=null,busy=false,selected=null,result=null,page=0,publisherPanel;
const locationKey='starforge-address-token:'+location.origin;
const fragment=new URLSearchParams(location.hash.slice(1));
const token=fragment.get('token')||sessionStorage.getItem(locationKey);
if(token){sessionStorage.setItem(locationKey,token);if(location.hash){const clean=new URL(location);clean.hash='';history.replaceState(null,'',clean);}}
const hpd={address:{street:{columns:['house_number','street_name'],separator:' '},city:{columns:['borough']},
  state_province:{constant:'NY'},country:{constant:'US'}},coordinates:{latitude:'latitude_internal',longitude:'longitude_internal'},
  identity:['project_id','building_id','bbl']};
const simply={address:{street:{columns:['address.streetNumberText','address.streetName'],separator:' '},
  street2:{columns:['address.unit']},city:{columns:['address.city']},state_province:{columns:['address.state']},
  postal_code:{columns:['address.postalCode']},country:{columns:['address.country']}},
  coordinates:{latitude:'geo.lat',longitude:'geo.lng'},identity:['mlsId','listingId']};
function announce(message,error=false){$('notice').textContent=message;$('notice').classList.toggle('error',error);}
function controls(){
  document.querySelectorAll('[data-write]').forEach(e=>{e.disabled=busy;});
  $('source-form').querySelector('button[type=submit]').disabled=busy||Boolean(state?.intake);
  $('restore-form').querySelector('button[type=submit]').disabled=busy||Boolean(state?.intake);
  $('qualified-apply').disabled=busy||!state?.addresses.some(row=>row.status==='QUALIFIED');
  $('export').disabled=busy||!state?.activeEditionId;
  $('query-next').disabled=busy||!result?.body?.page?.nextCursor;
  document.querySelectorAll('[data-run-request]').forEach(e=>{e.disabled=busy||!state?.api.configured;});
  publisherPanel?.controls(busy);
}
async function request(path,options={}){
  if(!token)throw new Error('Open this workspace using the private URL printed by its original server.');
  const response=await fetch(path,{...options,headers:{authorization:'Bearer '+token,...options.headers}});
  if(!response.ok){let value;try{value=await response.json();}catch{};throw new Error(value?.message||'HTTP '+response.status);}
  return response;
}
async function refresh(){
  state=await(await request('/api/state')).json();render();
}
async function perform(action,payload={}){
  const response=await request('/api/action',{method:'POST',headers:{'content-type':'application/json'},
    body:JSON.stringify({action,payload:action.startsWith('publisher.')?payload:{...payload,expectedRevision:state?.revision}})});
  const value=await response.json();state=value.state;
  if(['intake.import','package.import','provider.import','provider.run','policy.save','review.acceptQualified'].includes(action)){
    selected=null;$('address-detail').hidden=true;
  }
  render();return value.result;
}
async function handle(operation){
  if(busy)return;busy=true;controls();announce('Working…');
  const polling=setInterval(()=>{refresh().catch(()=>{});},4000);
  try{await operation();announce('Saved in the original workspace.');}
  catch(error){announce(error.message,true);try{await refresh();}catch{};}
  finally{clearInterval(polling);busy=false;controls();}
}
function bind(id,operation){$(id).addEventListener('submit',event=>{event.preventDefault();void handle(operation);});}
function switchTab(name){
  document.querySelectorAll('[data-section]').forEach(e=>{e.hidden=e.dataset.section!==name;});
  document.querySelectorAll('[data-tab]').forEach(e=>{if(e.dataset.tab===name)e.setAttribute('aria-current','page');else e.removeAttribute('aria-current');});
}
function selectOptions(control,rows){
  const previous=control.value;control.replaceChildren();
  for(const [value,label] of rows){const e=node('option',label);e.value=value;control.append(e);}
  if(rows.some(([value])=>value===previous))control.value=previous;
}
function mapping(value){
  $('source-mapping').value=json(value);
  const names=value===simply?[['mlsId','mls_id'],['listingId','listing_id'],['address.full','original_address'],['address.country','original_country']]:
    ['project_id','building_id','bbl','project_name','borough','reporting_construction_type','all_counted_units','total_units'].map(x=>[x,x]);
  $('dataset-columns').value=json(names.map(([source,name])=>({source,name})));
}
function renderMetrics(){
  const s=state.summary,area=$('summary');area.replaceChildren();
  for(const [value,label] of [[s?.sourceRows,'Original records'],[s?.uniqueQueries,'Address lookups'],
    [s?.reusedRows,'Shared lookup records'],[s?.invalidRows,'Source exceptions'],
    [s?.reviewedQueries,'Reviewed addresses'],[s?.candidateCount,'Retained candidates']]){
    const e=node('div',undefined,'metric');e.append(node('strong',count(value)),node('span',label));area.append(e);
  }
}
function renderRequests(){
  const area=$('requests');area.replaceChildren();
  for(const request of [...state.requests].reverse()){
    const e=node('article',undefined,'card'),head=node('div',undefined,'heading');
    head.append(node('h3',request.queryCount+' original address lookups'),node('span',request.status,'badge'));
    e.append(head,facts([['Prepared',request.createdAt],['Maximum lookups',request.maximumLookups],['Original endpoint',request.endpoint]]));
    if(request.status==='PREPARED')e.append(button('Run this reviewed batch','runRequest',request.id));
    if(['SENDING','UNCERTAIN'].includes(request.status))e.append(node('p','Retain this original request. Import its completed provider response to reconcile it before requesting these addresses again.','help'));
    if(request.receipt?.retryAfter)e.append(node('p','Provider retry guidance: '+request.receipt.retryAfter));
    e.append(button('Read original request','readRequest',request.id),detail('Original request and response identity',request));area.append(e);
  }
  if(!state.requests.length)area.append(node('p','Prepare the missing addresses or import the original response from an existing batch.','empty'));
  $('responses').textContent=json(state.responses);
  selectOptions($('response-query'),state.addresses.map(row=>[row.id,row.address]));
}
function filteredAddresses(){
  const find=$('review-search').value.toLowerCase().trim(),status=$('review-status').value;
  return state.addresses.filter(row=>(!status||row.status===status)&&(!find||(row.address+' '+row.providerAddress+' '+row.id).toLowerCase().includes(find)));
}
function renderAddresses(){
  const rows=filteredAddresses(),limit=50;page=Math.max(0,Math.min(page,Math.max(0,Math.ceil(rows.length/limit)-1)));
  const body=$('address-rows');body.replaceChildren();
  for(const row of rows.slice(page*limit,(page+1)*limit)){
    const tr=node('tr');
    for(const value of [row.address,row.sourceRows,row.status,row.accuracy,row.accuracyType,
      row.maximumDisplacementMeters===null?'—':row.maximumDisplacementMeters.toFixed(1)+' m'])tr.append(node('td',value));
    const td=node('td');td.append(button('Review','reviewQuery',row.id));tr.append(td);body.append(tr);
  }
  $('review-count').textContent=count(rows.length)+' addresses';
  $('review-page').textContent='Page '+(page+1)+' of '+Math.max(1,Math.ceil(rows.length/limit));
  $('review-prev').disabled=page===0;$('review-next').disabled=(page+1)*limit>=rows.length;
  const qualified=state.addresses.filter(row=>row.status==='QUALIFIED');
  $('qualified-count').textContent=qualified.length+' addresses meet the current score, type, key, country, ambiguity and coordinate-distance policy.';
  const groups=$('duplicate-groups');groups.replaceChildren();
  for(const group of state.duplicates){
    const e=node('article',undefined,'card');e.append(node('h3',group.stableAddressKey),
      node('p',group.queries.length+' distinct address queries · '+group.sourceRows+' original records'),
      detail('Original query bindings',group.queries));groups.append(e);
  }
  if(!state.duplicates.length)groups.append(node('p','Different retained query keys have no shared provider key in the current response set.','help'));
}
function renderSelected(){
  $('address-detail').hidden=!selected;if(!selected)return;
  $('detail-heading').textContent=[selected.query.street,selected.query.street2,selected.query.city,selected.query.state_province].filter(Boolean).join(', ');
  $('detail-summary').replaceChildren(facts([['Review state',selected.state],['Original records',selected.sourceRows],
    ['Original provider status',selected.providerStatus],['Provider error',selected.providerError],
    ['Review reasons',selected.reasons.join(', ')||'No candidate exceptions under the current policy']]));
  const area=$('candidates');area.replaceChildren();
  for(const candidate of selected.candidates){
    const card=node('article',undefined,'card'),label=node('label',undefined,'candidate-choice'),radio=node('input');
    radio.type='radio';radio.name='candidate';radio.value=candidate.id;
    radio.checked=candidate.id===(selected.decision?.candidateId||selected.recommended);
    radio.disabled=!candidate.location;
    label.append(radio,node('strong',candidate.formattedAddress||'Original provider candidate '+(candidate.index+1)));
    card.append(label,facts([['Accuracy',candidate.accuracy],['Accuracy type',candidate.accuracyType],['Match type',candidate.matchType],
      ['Provider coordinates',candidate.location],['Maximum disagreement',candidate.maximumDisplacementMeters===null?'No original coordinate pair':candidate.maximumDisplacementMeters.toFixed(1)+' m'],
      ['Provider source',candidate.providerSource],['Exceptions',candidate.reasons.join(', ')||'Qualified under current policy']]),
      detail('Original coordinates and provider candidate',candidate));area.append(card);
  }
  if(!selected.candidates.length)area.append(node('p','Retain the source or import the original provider result before selecting a match.','empty'));
  $('detail-raw').textContent=json(selected);
  $('decision-note').value=selected.decision?.note||'';
  $('coordinate-choice').value=selected.decision?.coordinateChoice||'preserve-source';
}
function renderEditions(){
  const area=$('editions');area.replaceChildren();
  for(const edition of [...state.editions].reverse()){
    const card=node('article',undefined,'card'),heading=node('div',undefined,'heading');
    heading.append(node('h3',edition.rowCount+' records'),node('span',edition.id===state.activeEditionId?'Selected edition':'Retained edition','badge'));
    card.append(heading,facts([['Created',edition.createdAt],['Scope',edition.scope]]),detail('Original edition and native snapshot',edition));
    if(edition.id!==state.activeEditionId)card.append(button('Select this edition','activateEdition',edition.id));area.append(card);
  }
}
function renderExports(){
  const area=$('exports');area.replaceChildren();
  for(const item of [...state.exports].reverse()){
    const card=node('article',undefined,'card');card.append(node('h3','Retained delivery · '+item.createdAt));
    const actions=node('div',undefined,'actions');
    for(const file of item.files){const e=button('Download '+file.name,'download',item.id);e.dataset.file=file.name;actions.append(e);}
    card.append(actions,detail('Delivery identity and retained files',item));area.append(card);
  }
}
function render(){
  $('workspace-path').textContent=state.directory;$('revision').textContent='Revision '+state.revision;
  $('source-details').textContent=json({source:state.source,intake:state.intake});
  $('provider-status').textContent=state.api.configured?'Original API key is configured for this operator. Each batch requires an explicit reviewed request.':
    'Import retained provider responses, or start the operator with GEOCODIO_API_KEY to run a reviewed batch.';
  const p=state.policy;$('policy-score').value=p.minimumAccuracy;$('policy-types').value=p.allowedAccuracyTypes.join(',');
  $('policy-distance').value=p.maximumDisplacementMeters;$('policy-gap').value=p.ambiguityScoreGap;
  $('policy-key').checked=p.requireStableAddressKey;$('policy-country').checked=p.requireCountryMatch;
  $('state-details').textContent=json(state);
  renderMetrics();renderRequests();renderAddresses();renderEditions();renderExports();publisherPanel?.render(state);controls();
}
async function openAddress(id){
  selected=await perform('review.query',{queryId:id});renderSelected();
  $('address-detail').scrollIntoView({behavior:'smooth',block:'start'});
}
function nativeQuery(){
  const params=new URLSearchParams($('query').value),query={};
  for(const [key,value] of params){if(Object.hasOwn(query,key))throw new Error('Each native query parameter must occur once.');query[key]=value;}
  return query;
}
async function runQuery(query){
  result=await perform('dataset.query',{query});
  $('query-result').textContent=json(result);
  const area=$('query-table');area.replaceChildren();
  if(result.status!==200){$('query-summary').textContent=result.body?.message||'Native query rejected.';return;}
  const body=result.body;$('query-summary').textContent=count(body.page.returned)+' returned · '+count(body.page.total)+' in selection';
  const table=node('table'),head=node('thead'),header=node('tr'),values=node('tbody');
  for(const field of body.fields)header.append(node('th',field));head.append(header);
  for(const row of body.rows){const tr=node('tr');for(const field of body.fields)tr.append(node('td',row[field]===null?'null':row[field]));values.append(tr);}
  table.append(head,values);area.append(table);controls();
}
async function download(id,name){
  const response=await request('/api/exports/'+encodeURIComponent(id)+'/'+encodeURIComponent(name));
  const url=URL.createObjectURL(await response.blob()),a=node('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
document.querySelectorAll('[data-tab]').forEach(e=>e.addEventListener('click',()=>switchTab(e.dataset.tab)));
$('refresh').addEventListener('click',()=>{refresh().then(()=>announce('Current workspace loaded.')).catch(error=>announce(error.message,true));});
$('mapping-hpd').addEventListener('click',()=>mapping(hpd));$('mapping-simplyrets').addEventListener('click',()=>mapping(simply));
$('source-format').addEventListener('change',()=>{if($('source-format').value==='simplyrets')mapping(simply);});
bind('source-form',async()=>{
 const payload={path:$('source-path').value,format:$('source-format').value,sourceURL:$('source-url').value||null,
   ...($('source-original').value?{sourcePath:$('source-original').value}:{}),
   provenance:$('source-provenance').value||'operator-selected source',mapping:JSON.parse($('source-mapping').value)};
 await perform('intake.import',payload);switchTab('batch');
});
bind('restore-form',async()=>{await perform('package.import',{path:$('restore-path').value});switchTab('review');});
bind('batch-prepare',()=>perform('provider.prepare',{maximumLookups:Number($('batch-limit').value)}));
$('requests').addEventListener('click',event=>{
 const e=event.target.closest('button');if(!e)return;
 if(e.dataset.runRequest)void handle(async()=>{
   const original=state.requests.find(request=>request.id===e.dataset.runRequest);
   if(!original)throw new Error('Refresh the retained batch selection.');
   await perform('provider.run',{id:original.id,expectedRequestSha256:original.request.sha256});
 });
 if(e.dataset.readRequest)void handle(async()=>{
   const r=await perform('provider.request',{id:e.dataset.readRequest});
   $('request-body').textContent=json(r);$('request-detail').hidden=false;
   $('request-detail').scrollIntoView({behavior:'smooth',block:'start'});
 });
});
bind('response-form',async()=>{
 const receipt={status:Number($('response-status').value)};
 if($('response-date').value)receipt.receivedAt=$('response-date').value;
 await perform('provider.import',{responsePath:$('response-path').value,requestPath:$('response-request').value,
   mode:$('response-mode').value,queryId:$('response-query').value,receipt});switchTab('review');
});
bind('policy-form',()=>perform('policy.save',{policy:{minimumAccuracy:Number($('policy-score').value),
 allowedAccuracyTypes:$('policy-types').value.split(',').map(x=>x.trim()).filter(Boolean),
 maximumDisplacementMeters:Number($('policy-distance').value),ambiguityScoreGap:Number($('policy-gap').value),
 requireStableAddressKey:$('policy-key').checked,requireCountryMatch:$('policy-country').checked}}));
for(const id of ['review-search','review-status'])$(id).addEventListener('input',()=>{page=0;renderAddresses();});
$('review-prev').addEventListener('click',()=>{page--;renderAddresses();});$('review-next').addEventListener('click',()=>{page++;renderAddresses();});
$('address-rows').addEventListener('click',event=>{const e=event.target.closest('[data-review-query]');if(e)void handle(()=>openAddress(e.dataset.reviewQuery));});
bind('decision-form',async()=>{
 if(!selected)throw new Error('Select an original address.');
 const candidate=document.querySelector('input[name=candidate]:checked')?.value;
 if(!candidate)throw new Error('Select a retained provider candidate.');
 await perform('review.decide',{queryId:selected.id,candidateId:candidate,action:'accept',
   coordinateChoice:$('coordinate-choice').value,note:$('decision-note').value});
 await openAddress(selected.id);
});
$('keep-source').addEventListener('click',()=>void handle(async()=>{
 if(!selected)throw new Error('Select an original address.');
 await perform('review.decide',{queryId:selected.id,action:'keep-source',note:$('decision-note').value});
 await openAddress(selected.id);
}));
bind('qualified-form',()=>perform('review.acceptQualified',{queryIds:state.addresses.filter(row=>row.status==='QUALIFIED').map(row=>row.id),
 coordinateChoice:$('qualified-coordinate').value,note:$('qualified-note').value}));
bind('edition-form',async()=>{
 await perform('edition.build',{name:$('dataset-name').value,scope:$('dataset-scope').value,
   sourceColumns:JSON.parse($('dataset-columns').value),defaultLimit:Number($('dataset-page-size').value),maxLimit:Number($('dataset-max-page').value)});
 await runQuery({limit:$('dataset-page-size').value});
});
$('editions').addEventListener('click',event=>{const e=event.target.closest('[data-activate-edition]');if(e)void handle(()=>perform('edition.activate',{editionId:e.dataset.activateEdition}));});
bind('query-form',()=>runQuery(nativeQuery()));
$('load-query').addEventListener('click',()=>{if(state.lastQuery?.initialQuery)$('query').value=new URLSearchParams(state.lastQuery.initialQuery).toString();});
$('query-next').addEventListener('click',()=>void handle(async()=>{
 if(!state.lastQuery||!result?.body?.page?.nextCursor)throw new Error('Run a native query with a remaining page.');
 await runQuery({...state.lastQuery.query,cursor:result.body.page.nextCursor});
}));
bind('merchant-form',()=>perform('merchant.configure',{merchant:{origin:$('merchant-origin').value,path:$('merchant-path').value,
 payment:JSON.parse($('merchant-payment').value)}}));
$('export').addEventListener('click',()=>void handle(()=>perform('package.export')));
$('exports').addEventListener('click',event=>{const e=event.target.closest('[data-download]');if(e)void handle(()=>download(e.dataset.download,e.dataset.file));});
async function publisherDownload(kind,id){
  const response=await request('/api/publisher/exports/'+encodeURIComponent(kind)+'/'+encodeURIComponent(id));
  const disposition=response.headers.get('content-disposition')||'',match=/filename\*=UTF-8''([^;]+)/i.exec(disposition);
  const name=match?decodeURIComponent(match[1]):kind+'-'+id;
  const url=URL.createObjectURL(await response.blob()),a=node('a');a.href=url;a.download=name;a.click();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
}
publisherPanel=createPublisherPanel({getState:()=>state,perform,download:publisherDownload,handle,
  notice:message=>announce(message),selectSection:name=>switchTab(name==='exports'?'delivery':name)});
mapping(hpd);controls();
refresh().then(()=>announce('Original workspace loaded.')).catch(error=>announce(error.message,true));
