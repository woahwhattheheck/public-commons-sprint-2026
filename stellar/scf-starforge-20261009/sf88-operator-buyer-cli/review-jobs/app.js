// MIT. All provider and operator text is rendered as text, never executable markup.
const $=id=>document.getElementById(id);
const storageKey='sf-resource-session';
let token=location.hash.slice(1)||sessionStorage.getItem(storageKey)||'';
if(location.hash){sessionStorage.setItem(storageKey,token);history.replaceState(null,'',location.pathname);}
let current=null,context=null,source=null,catalog=null,service=null,resource=null,serviceRowIndex=null,offset=0,busy=false;
const drafts=new Map(),pending=new Map();
function node(tag,text,cls){const e=document.createElement(tag);if(text!==undefined)e.textContent=text;if(cls)e.className=cls;return e;}
function message(text,error=false){$('message').textContent=text;$('message').classList.toggle('error',error);}
function pretty(value){return JSON.stringify(value,null,2);}
function safeError(e){return e?.message||'Workspace operation failed';}
function facts(id,entries){
  const target=$(id);target.replaceChildren();
  for(const [label,value]of entries){target.append(node('dt',label),node('dd',value===null||value===undefined?'—':String(value)));}
}
function base64(bytes){
  let text='';for(let i=0;i<bytes.length;i+=32768)text+=String.fromCharCode(...bytes.subarray(i,i+32768));
  return btoa(text);
}
async function api(route,method='GET',data,original=false){
  const response=await fetch((original?'/api/':'/api/review-jobs/')+route,{
    method,headers:{Authorization:'Bearer '+token,'Content-Type':'application/json'},
    ...(data===undefined?{}:{body:JSON.stringify(data)})});
  let value;try{value=await response.json();}catch{throw new Error('Response unavailable; refresh the retained job before retrying.');}
  if(!response.ok){const error=new Error(value.error||'HTTP_'+response.status);error.status=response.status;throw error;}
  return value;
}
async function run(work){
  if(busy)return;busy=true;
  try{await work();}catch(e){message(safeError(e),true);}
  finally{busy=false;renderControls();}
}
function remember(){
  if(!current)return;
  const values={};for(const input of document.querySelectorAll('[data-draft]'))values[input.id]=input.value;
  drafts.set(current.job.externalId,values);
}
function restoreDraft(id){
  const values=drafts.get(id);
  if(values)for(const [key,value]of Object.entries(values))$(key).value=value;
}
function options(select,rows,value,label){
  const before=select.value;select.replaceChildren();
  for(const row of rows){const option=node('option',label(row));option.value=value(row);select.append(option);}
  if([...select.options].some(o=>o.value===before))select.value=before;
}
function download(data){
  const anchor=node('a');anchor.href=data.url;anchor.download='';document.body.append(anchor);anchor.click();anchor.remove();
  message('Download prepared · '+data.bytes+' bytes · SHA-256 '+data.sha256);
}
async function mutate(route,input,{operation=false}={}){
  let key;
  if(operation){
    key=route+':'+(input.kind??'')+':'+input.externalId;
    if(pending.has(key))input=pending.get(key);
    else{
      const retained=route==='deliver'&&current?.job.externalId===input.externalId?current.job.deliveryAttempt:null;
      if(retained&&retained.operationId!==current.job.delivery?.operationId&&retained.status!=='rejected')
        input={...input,operationId:retained.operationId,name:retained.request.name,note:retained.request.note};
      else input={...input,operationId:crypto.randomUUID()};
      pending.set(key,input);
    }
  }
  try{
    const result=await api(route,'POST',input);
    if(key)pending.delete(key);return result;
  }catch(error){
    // Known rejected requests can be corrected; uncertain transport/server completion
    // keeps the exact operation input. Durable delivery intents also survive reload.
    if(key&&error.status>=400&&error.status<500&&error.status!==429)pending.delete(key);
    throw error;
  }
}
function jobInput(){if(!current)throw new Error('Select a retained job.');return {externalId:current.job.externalId,revision:current.job.revision};}
function renderJobs(){
  const list=$('job-list');list.replaceChildren();
  for(const row of context.jobs.items){
    const card=node('button',undefined,'job-card'+(current?.job.externalId===row.externalId?' selected':''));
    card.append(node('strong',row.title),node('span',row.externalId),node('span',row.service+' · '+row.owner),
      node('span',(row.active?'RUNNING '+row.active.kind:row.original?.state??'NOT PREPARED')+
        (row.delivery?' · DELIVERY r'+row.delivery.collectionRevision:''),'job-meta'));
    card.onclick=()=>run(()=>selectJob(row.externalId));list.append(card);
  }
  if(!context.jobs.items.length)list.append(node('p','No matching jobs. Open a new job from a retained source.','muted'));
  $('job-count').textContent=String(context.jobs.total);
  $('page').textContent=(context.jobs.total?offset+1:0)+'–'+Math.min(offset+context.jobs.limit,context.jobs.total);
  $('prev').disabled=offset===0;$('next').disabled=offset+context.jobs.limit>=context.jobs.total;
}
async function loadContext(){
  context=await api('context?offset='+offset+'&q='+encodeURIComponent($('job-query').value));
  renderJobs();
  options($('source-select'),context.sources,r=>r.sha256,r=>r.kind+' · '+(r.retrievedAt??r.importedAt)+' · '+r.rowCount+' rows · '+r.sha256.slice(0,10));
  options($('catalog-select'),context.catalogs,r=>r.sha256,r=>r.sha256.slice(0,16)+' · '+r.rowCount+' offers');
  if(!source&&$('source-select').value)await loadSource();
  if(!catalog&&$('catalog-select').value)await loadCatalog();
}
async function loadSource(){
  service=null;serviceRowIndex=null;
  if(!$('source-select').value){source=null;renderServices();return;}
  source=await api('source?sha256='+$('source-select').value);renderServices();
}
function renderServices(){
  $('services').replaceChildren();
  if(!source){$('source-info').textContent='Retain a free source read or import its JSON to begin.';return;}
  $('source-info').textContent=source.source.url+' · '+source.source.bytes+' bytes · '+source.source.sha256;
  const q=$('service-filter').value.toLowerCase();
  for(const row of source.rows.filter(row=>!q||[row.service,row.endpoint,row.category].join(' ').toLowerCase().includes(q))){
    const rowIndex=source.rows.indexOf(row),tr=node('tr');if(serviceRowIndex===rowIndex)tr.className='selected';
    const cell=node('td'),button=node('button',row.service);button.onclick=()=>{service=row;serviceRowIndex=rowIndex;renderServices();};cell.append(button,node('div',row.endpoint??'','muted'));
    tr.append(cell,node('td',row.category??'—'),node('td',row.verdict??'—'),node('td',row.methodology_version??'—'),node('td',row.price_per_call??'—'));
    $('services').append(tr);
  }
  $('service-selected').textContent=service?'Selected: '+service.service+' · '+(service.endpoint??'No endpoint in source'):'Select a service above.';
}
async function loadCatalog(){
  if(!$('catalog-select').value){catalog=null;renderCatalogRows();return;}
  catalog=await api('catalog?sha256='+$('catalog-select').value);renderCatalogRows();
}
function renderCatalogRows(){
  options($('catalog-row'),catalog?.rows??[],r=>String(r.index),r=>r.method+' '+(typeof r.resource==='string'?r.resource:r.resource?.url??'Unresolved resource'));
  renderAccepted();
}
function renderAccepted(){
  const row=catalog?.rows.find(r=>r.index===Number($('catalog-row').value));
  options($('catalog-accept'),(row?.accepts??[]).map((value,index)=>({value,index})),r=>String(r.index),
    r=>r.value.scheme+' · '+r.value.network+' · '+r.value.amount+' atomic');
  if(row&&!current?.job.binding){
    $('request-url').value=typeof row.resource==='string'?row.resource:row.resource?.url??'';
    $('request-method').value=row.method??'GET';
  }
  showAccept();
}
function showAccept(){
  const row=catalog?.rows.find(r=>r.index===Number($('catalog-row').value));
  $('accept-details').textContent=row?pretty(row.accepts[Number($('catalog-accept').value)]):'No native offers imported.';
}
async function selectJob(id){
  remember();current=await api('job?id='+encodeURIComponent(id));
  $('intake').hidden=true;$('empty').hidden=true;$('workspace').hidden=false;
  const job=current.job;
  $('assigned-owner').value=job.owner;$('assignment-note').value='';
  $('request-reviewer').value=job.approval?.reviewer??job.owner;
  $('request-note').value=job.approval?.note??'';
  $('result-reviewer').value=job.resultReview?.reviewer??job.owner;
  $('result-note').value=job.resultReview?.note??'';
  $('delivery-name').value=job.delivery?.name??job.title;
  $('delivery-note').value=job.delivery?.note??'';
  $('mapping-note').value=job.binding?.mappingNote??'';
  $('intent-id').value=job.binding?.intentId??'';
  $('request-body').value='';$('request-headers').value='{}';
  renderAccepted();restoreDraft(id);resource=null;renderCurrent();renderJobs();
  message('Opened retained job '+id+'.');
}
function renderCurrent(){
  if(!current)return;
  const job=current.job,binding=job.binding;
  $('job-id').textContent=job.externalId;$('job-title').textContent=job.title;
  $('job-revision').textContent='REVISION '+job.revision;$('job-objective').textContent=job.objective;
  facts('job-summary',[['Service',job.service],['Owner',job.owner],['Created',job.createdAt],['Updated',job.updatedAt]]);
  $('published-source').textContent=job.publishedSource.url+' · SHA-256 '+job.sourceSha256;
  $('published-review').textContent=pretty(job.publishedReview);
  $('binding-state').textContent=binding?.status??'Not prepared';
  $('prepare-fields').hidden=Boolean(binding?.status==='prepared');$('binding-details').hidden=!binding;
  $('binding-details').textContent=binding?pretty(binding):'';
  $('native-state').textContent=current.active?'RUNNING '+current.active.kind:current.original?.state??'Not prepared';
  $('request-review').textContent=job.requestReview?pretty(job.requestReview.view):'';
  $('approval-status').textContent=job.approval?'Approved by '+job.approval.reviewer+' at '+job.approval.at:'No named approval recorded.';
  $('native-outcome').textContent=current.original?pretty(current.original):'';
  $('actions-history').replaceChildren();
  for(const action of [...job.actions].reverse().slice(0,12)){
    const row=node('div',undefined,'history-row');row.append(node('strong',action.kind+' · '+action.status),
      node('div',action.id+' · '+action.startedAt+(action.error?' · '+action.error:'')));
    if(action.approval)row.append(node('div','Execution approved by '+action.approval.reviewer+' at '+action.approval.at));
    $('actions-history').append(row);
  }
  options($('resource-select'),current.resources,r=>r.id,r=>(r.name??r.id.slice(0,16))+' · '+r.status+' · '+(r.bytes??0)+' bytes');
  const selected=current.resources.find(r=>r.id===$('resource-select').value)??null;
  if(resource?.id!==selected?.id){resource=selected;$('result-preview').textContent='';$('preview-coverage').textContent='';}
  else resource=selected;
  facts('resource-facts',resource?[['Status',resource.status],['Native buyer',resource.buyerStatus],['Delivery',resource.deliveryStatus],
    ['HTTP',resource.httpStatus],['Content type',resource.contentType],['Bytes',resource.bytes],['SHA-256',resource.sha256],
    ['Annotation revision',resource.annotation.revision]]:[]);
  $('result-review-status').textContent=job.resultReview?'Reviewed by '+job.resultReview.reviewer+' · annotation r'+job.resultReview.annotationRevision+' · '+job.resultReview.sha256:'No named result review yet.';
  $('delivery-state').textContent=job.delivery?'EDITION '+job.delivery.collectionRevision:'Not selected';
  $('delivery-details').textContent=job.delivery?job.delivery.collectionId+' / r'+job.delivery.collectionRevision+' · result '+job.delivery.resultSha256:'';
  if(job.deliveryAttempt&&job.deliveryAttempt.operationId!==job.delivery?.operationId)
    $('delivery-details').textContent=job.deliveryAttempt.status==='rejected'
      ?'Original collection refused this selection before commit: '+job.deliveryAttempt.error+'. Review current data, then select a new delivery.'
      :'Retained delivery selection requires reconciliation: '+job.deliveryAttempt.operationId;
  $('deliver').textContent=job.deliveryAttempt&&job.deliveryAttempt.operationId!==job.delivery?.operationId&&job.deliveryAttempt.status!=='rejected'
    ?'Reconcile retained delivery':'Select named delivery';
  renderControls();
}
function renderControls(){
  if(!current)return;
  const job=current.job,active=Boolean(current.active),prepared=job.binding?.status==='prepared';
  for(const id of ['prepare','review','approve','execute','recover','finalize','cancel','annotate','deliver','assign'])$(id).disabled=busy||active;
  $('prepare').disabled||=!catalog;
  $('review').disabled||=!prepared;
  $('approve').disabled||=!job.requestReview;
  $('execute').disabled||=!prepared||!job.approval||Boolean(current.original?.attempt)||current.original?.state==='CANCELLED';
  $('recover').disabled||=!prepared;
  $('finalize').disabled||=!prepared||!current.canFinalize;
  $('cancel').disabled||=!prepared||Boolean(current.original?.attempt)||current.original?.state==='CANCELLED';
  $('stop').hidden=!current.active?.operationId;$('stop').disabled=busy;
  $('annotate').disabled||=!resource||resource.status!=='VERIFIED';
  $('deliver').disabled||=!job.resultReview&&!job.deliveryAttempt;
  for(const id of ['preview','resource-download'])$(id).disabled=busy||!resource||resource.status!=='VERIFIED';
  for(const id of ['delivery-download','handoff-download'])$(id).disabled=busy||(id==='delivery-download'&&!job.delivery);
}
async function refresh(){
  await loadContext();
  if(current){current=await api('job?id='+encodeURIComponent(current.job.externalId));renderCurrent();}
}
$('refresh').onclick=()=>run(async()=>{await refresh();message('Retained workspace refreshed.');});
$('intake-open').onclick=()=>{$('intake').hidden=false;$('intake').scrollIntoView({behavior:'smooth'});};
$('intake-close').onclick=()=>{$('intake').hidden=true;};
$('source-select').onchange=()=>run(loadSource);$('service-filter').oninput=renderServices;
$('catalog-select').onchange=()=>run(loadCatalog);$('catalog-row').onchange=renderAccepted;$('catalog-accept').onchange=showAccept;
$('job-query').oninput=()=>{offset=0;clearTimeout(window.queryTimer);window.queryTimer=setTimeout(()=>run(loadContext),200);};
$('prev').onclick=()=>run(async()=>{offset=Math.max(0,offset-50);await loadContext();});
$('next').onclick=()=>run(async()=>{offset+=50;await loadContext();});
$('source-fetch').onclick=()=>run(async()=>{
  const result=await api('source/fetch','POST',{kind:$('source-kind').value,query:$('source-query').value});
  await loadContext();$('source-select').value=result.source.sha256;await loadSource();
  message('Retained actual published source '+result.source.sha256+'.');
});
$('source-import').onclick=()=>run(async()=>{
  const file=$('source-file').files[0];if(!file)throw new Error('Choose the retained source JSON.');
  if(file.size>2097152)throw new Error('Browser import supports 2 MiB; use the native CLI for a larger source.');
  const result=await api('source/import','POST',{contentBase64:base64(new Uint8Array(await file.arrayBuffer())),
    metadata:{kind:$('source-kind').value,url:$('source-url').value,retrievedAt:$('source-date').value||null,acquisition:'operator-retained'}});
  await loadContext();$('source-select').value=result.source.sha256;await loadSource();
  message('Retained source bytes and their original acquisition context.');
});
$('catalog-import').onclick=()=>run(async()=>{
  const file=$('catalog-file').files[0];if(!file)throw new Error('Choose the original catalog JSON.');
  const result=await api('catalog/import','POST',{contentBase64:base64(new Uint8Array(await file.arrayBuffer()))});
  await loadContext();$('catalog-select').value=result.sha256;await loadCatalog();
  message('Retained original catalog '+result.sha256+'.');
});
$('create').onclick=()=>run(async()=>{
  if(!source||!service)throw new Error('Select one published service first.');
  const result=await api('create','POST',{externalId:$('new-id').value,title:$('new-title').value,owner:$('new-owner').value,
    objective:$('new-objective').value,sourceSha256:source.source.sha256,service:service.service,sourceRow:serviceRowIndex});
  await loadContext();await selectJob(result.externalId);
});
$('assign').onclick=()=>run(async()=>{await api('assign','POST',{...jobInput(),owner:$('assigned-owner').value,note:$('assignment-note').value});await refresh();message('Assignment saved.');});
$('prepare').onclick=()=>run(async()=>{
  if(!catalog)throw new Error('Select an original saved native catalog.');
  const body=$('request-body').value,bodyBytes=new TextEncoder().encode(body);
  if(bodyBytes.length>1048576)throw new Error('The review-job body limit is 1 MiB.');
  const input={...jobInput(),catalogSha256:catalog.sha256,rowIndex:Number($('catalog-row').value),
    acceptIndex:Number($('catalog-accept').value),url:$('request-url').value,method:$('request-method').value,
    headers:JSON.parse($('request-headers').value||'{}'),mappingNote:$('mapping-note').value};
  if(body!=='')input.bodyBase64=base64(bodyBytes);if($('intent-id').value)input.intentId=$('intent-id').value;
  await api('prepare','POST',input);await refresh();message('Original native request prepared under the retained job intent.');
});
$('review').onclick=()=>run(async()=>{await api('review','POST',jobInput());await refresh();message('Review the exact original request, payment terms, body hash and output limits above.');});
$('approve').onclick=()=>run(async()=>{
  await api('approve','POST',{...jobInput(),reviewId:current.job.requestReview.id,reviewer:$('request-reviewer').value,note:$('request-note').value});
  await refresh();message('Named approval saved for this exact request.');
});
for(const kind of ['execute','recover','finalize','cancel'])$(kind).onclick=()=>run(async()=>{
  await mutate('action',{...jobInput(),kind},{operation:true});await refresh();
  message('Original '+kind+' operation retained. It continues if this tab closes.');
});
$('stop').onclick=()=>run(async()=>{
  await api('stop','POST',{externalId:current.job.externalId,operationId:current.active.operationId});await refresh();
  message('Stop requested. Retain the original intent and reconcile its outcome.');
});
$('scan').onclick=()=>run(async()=>{await api('scan','POST',{});await refresh();message('Original resource index refreshed.');});
$('resource-select').onchange=()=>{resource=null;renderCurrent();};
$('preview').onclick=()=>run(async()=>{
  const value=await api('resources/'+resource.id+'/preview','GET',undefined,true);
  $('preview-coverage').textContent='Verified '+value.bytes+' bytes · '+value.coverage+' text coverage · SHA-256 '+value.sha256;
  $('result-preview').textContent=value.text??'Binary content: download the complete verified file.';
});
$('resource-download').onclick=()=>run(async()=>download(await api('resources/'+resource.id+'/download','POST',{},true)));
$('annotate').onclick=()=>run(async()=>{
  await mutate('annotate',{...jobInput(),resourceId:resource.id,resourceSha256:resource.sha256,
    annotationRevision:resource.annotation.revision,reviewer:$('result-reviewer').value,note:$('result-note').value},{operation:true});
  await refresh();message('Named analyst review saved against the exact original result.');
});
$('deliver').onclick=()=>run(async()=>{
  const attempt=current.job.deliveryAttempt;
  if(attempt&&attempt.operationId!==current.job.delivery?.operationId)
    await api('deliver','POST',{...jobInput(),operationId:attempt.operationId,name:attempt.request.name,note:attempt.request.note});
  else await mutate('deliver',{...jobInput(),name:$('delivery-name').value,note:$('delivery-note').value},{operation:true});
  await refresh();message('Selected the named delivery edition with complete file bytes and pinned review.');
});
$('delivery-download').onclick=()=>run(async()=>download(await api('delivery/download','POST',{externalId:current.job.externalId})));
$('handoff-download').onclick=()=>run(async()=>download(await api('handoff/download','POST',{externalId:current.job.externalId})));
for(const id of ['library-link','collections-link','resource-open'])$(id).addEventListener('click',()=>{
  $(id).hash=token;remember();
});
for(const input of document.querySelectorAll('[data-draft]'))input.addEventListener('input',remember);
run(async()=>{
  if(!token)throw new Error('Open the private review-jobs URL printed by the original foreground command.');
  await loadContext();$('intake').hidden=Boolean(context.jobs.total);
  message('Private review-job workspace ready. Published verdicts remain separate from analyst findings.');
});
setInterval(()=>{if(!busy)run(refresh);},5000);
