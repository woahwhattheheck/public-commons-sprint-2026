// MIT. Original source is rendered as text; operator edits remain explicit saved revisions.
const $=id=>document.getElementById(id);
const escape=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const json=value=>JSON.stringify(value,null,2);
const stamp=value=>value?String(value).replace('T',' ').replace(/\.\d{3}Z$/,' UTC'):'Unreported';
const bytes=value=>value<1024?value+' B':value<1048576?(value/1024).toFixed(1)+' KiB':(value/1048576).toFixed(2)+' MiB';
const id=()=>crypto.randomUUID();
const textValue=value=>value===null||value===undefined||value===''?'Unreported':typeof value==='object'?json(value):String(value);
const split=value=>value.split('|').map(v=>v.trim()).filter(Boolean);
const reviewFields=['status','owner','fit','eligibilityAssessment','partner','workshare','deliverables','acceptance','schedule','fee','nextAction','notes'];
const reviewLabels={status:'Qualification status',owner:'Responsible owner',fit:'Fit and opportunity',
  eligibilityAssessment:'Eligibility assessment',partner:'Delivery partner',workshare:'Proposed workshare',
  deliverables:'Deliverables',acceptance:'Acceptance criteria',schedule:'Delivery schedule',fee:'Service fee',
  nextAction:'Next action',notes:'Working notes'};
const shortFields=new Set(['owner','partner','schedule','fee','nextAction']);
let session=new URLSearchParams(location.hash.slice(1)).get('session');
if(session){sessionStorage.setItem('grants-session',session);history.replaceState(null,'',location.pathname);}
else session=sessionStorage.getItem('grants-session');
let state,editionId,opened,dirty=false,pageOffset=0,pageSnapshot=null,rowPage,comparison,comparisonOffset=0,publisherState,buyerReview;
let queryRevision=0,queryId=null,polling=false;
const selected=new Set();

function notice(message,isError=false){
  $('notice').textContent=message;$('notice').classList.toggle('error',isError);$('notice').hidden=!message;
}
async function request(path,body){
  const response=await fetch(path,{method:body?'POST':'GET',credentials:'omit',cache:'no-store',
    headers:{Authorization:'Bearer '+session,...(body?{'Content-Type':'application/json'}:{})},
    ...(body?{body:JSON.stringify(body)}:{})});
  const data=await response.json();
  if(!response.ok||!data.ok)throw Object.assign(new Error(data.error?.message??'The workspace request failed.'),{code:data.error?.code,status:response.status});
  return data.result;
}
async function action(actionName,input={},remember=false){
  const payload={action:actionName,input};
  if(remember){sessionStorage.setItem('grants-pending',JSON.stringify(payload));$('pending').hidden=false;}
  try{
    const result=await request('/api/action',payload);
    if(remember){sessionStorage.removeItem('grants-pending');$('pending').hidden=true;}
    return result;
  }catch(failure){
    if(remember&&failure.status){sessionStorage.removeItem('grants-pending');$('pending').hidden=true;}
    throw failure;
  }
}
async function run(task,message){
  try{notice('');const result=await task();if(message)notice(message);return result;}
  catch(error){notice(error.message+(error.code?' · '+error.code:''),true);return null;}
}
function switchView(name){
  document.querySelectorAll('[data-panel]').forEach(panel=>panel.hidden=panel.id!=='view-'+name);
  document.querySelectorAll('nav [data-view]').forEach(button=>{
    if(button.dataset.view===name)button.setAttribute('aria-current','page');else button.removeAttribute('aria-current');
  });
}
function options(element,items,{empty=false,label=value=>value.name??value.id}={}){
  const before=element.value;
  element.innerHTML=(empty?'<option value="">New search</option>':'')+
    items.map(value=>'<option value="'+escape(value.id)+'">'+escape(label(value))+'</option>').join('');
  if(items.some(value=>value.id===before)||empty&&before==='')element.value=before;
}
function summaryCapture(value){
  const coverage=value.progress?.coverage??value.native?.coverage??{};
  return {coverage,complete:coverage.detailCount??value.native?.details??0,total:coverage.expectedHits??0,
    seen:coverage.uniqueOpportunities??0,status:value.progress?.status??value.status};
}
function renderCaptures(){
  $('captures').innerHTML=state.captures.length?state.captures.slice().reverse().map(value=>{
    const {coverage,complete,total,seen}=summaryCapture(value),running=value.running||state.jobs.some(job=>job.id===value.id);
    return '<article class="capture-card"><h3>'+escape(value.name)+'</h3><span class="badge">'+escape(value.status)+'</span>'+
      '<div class="capture-stats"><span><strong>'+seen+' / '+total+'</strong> opportunities</span><span><strong>'+complete+'</strong> complete details</span></div>'+
      '<p class="muted">'+escape(stamp(value.createdAt))+' · '+escape(value.query?.keyword??'Saved query')+'</p>'+
      (value.error?'<p class="muted">'+escape(value.error.message)+'</p>':'')+
      (coverage.warnings?.length?'<details><summary>Source coverage notes</summary><pre>'+escape(json(coverage.warnings))+'</pre></details>':'')+
      '<div class="toolbar">'+(running?'<button data-pause="'+escape(value.id)+'">Pause capture</button>':
        value.status!=='complete'?'<button data-resume="'+escape(value.id)+'">Resume capture</button>':'')+
      (value.editionId?'<button data-edition="'+escape(value.editionId)+'">Open edition</button>':'')+
      (!running&&seen?'<button data-capture-edition="'+escape(value.id)+'">Save current edition</button>':'')+
      (!running?'<button data-capture-export="'+escape(value.id)+'">Export source</button>':'')+'</div></article>';
  }).join(''):'<p class="empty">Save a search and capture its original results, or receive an existing source file.</p>';
}
function renderMerchants(){
  $('merchants').innerHTML=state.merchants.length?state.merchants.slice().reverse().map(value=>
    '<article class="saved-card"><h3>'+escape(value.dataset.name??value.id)+'</h3><p class="muted">'+escape(value.id)+' · '+
    escape(stamp(value.createdAt))+'</p><p>'+escape(value.dataset.rowCount??value.dataset.rows??'')+' rows · '+
    (value.configured?'Public terms configured':'Local dataset ready')+'</p><div class="toolbar">'+
    '<button data-merchant-export="'+escape(value.id)+'">Export complete package</button>'+
    (value.configured?'<button data-publisher-prepare="'+escape(value.id)+'">Prepare native draft</button>':'')+
    '</div></article>').join(''):'<p class="empty">Prepare an edition to create its dataset, query configuration and retained source.</p>';
}
function renderExports(){
  $('exports').innerHTML=state.exports.length?state.exports.slice().reverse().map(value=>
    '<article class="saved-card"><h3>'+escape(value.kind)+'</h3><p>'+bytes(value.bytes)+' · '+escape(stamp(value.createdAt))+
    '</p><p class="muted"><code>'+escape(value.sha256)+'</code></p><button data-download="'+escape(value.id)+'">Download complete file</button></article>'
  ).join(''):'<p class="empty">Complete exports appear here and remain available when the workspace reopens.</p>';
}
async function refresh({load=true}={}){
  const previousEdition=editionId;
  state=await request('/api/state');
  $('workspace-label').textContent=state.name+' · r'+state.revision;
  $('attribution').textContent=state.attribution;
  const editions=state.editions.slice().reverse();
  for(const key of ['edition','compare-before','compare-after','merchant-edition','export-edition'])
    options($(key),editions,{label:value=>value.name+' · '+value.rowCount+' opportunities · '+stamp(value.createdAt)});
  options($('query-existing'),state.queries,{empty:true});
  options($('export-capture'),state.captures,{label:value=>value.name+' · '+value.status});
  for(const key of ['preview-merchant','export-merchant'])options($(key),state.merchants,{label:value=>value.dataset.name+' · '+value.id});
  if(editionId&&editions.some(value=>value.id===editionId))$('edition').value=editionId;
  else editionId=$('edition').value||null;
  renderCaptures();renderMerchants();renderExports();
  $('backup').disabled=!state.captures.length||state.jobs.length>0;
  if(load||previousEdition!==editionId)await loadRows();
}
function chooseEdition(value){
  if(dirty&&!confirm('Discard the unsaved qualification edits?'))return false;
  editionId=value;$('edition').value=value;pageOffset=0;pageSnapshot=null;selected.clear();opened=null;dirty=false;
  $('opportunity-detail').innerHTML='<div class="empty"><h2>Choose an opportunity</h2><p>Open a notice from the selected edition.</p></div>';
  return true;
}
async function loadRows(){
  if(!editionId){
    $('opportunity-rows').innerHTML='<tr><td colspan="5"><div class="empty"><h2>Your research starts with an original capture</h2><p>Save a search, capture all of its notices, or receive an existing workspace.</p><button data-open-view="search">Search and capture</button></div></td></tr>';
    $('edition-summary').textContent='';$('page-summary').textContent='';$('previous-page').disabled=true;$('next-page').disabled=true;return;
  }
  rowPage=await action('opportunity.list',{editionId,search:$('row-search').value,status:$('row-status').value,
    agency:$('row-agency').value.trim(),closingFrom:$('row-from').value,closingTo:$('row-to').value,sort:$('row-sort').value,
    offset:pageOffset,limit:25,...(pageOffset&&pageSnapshot?{expectedSnapshot:pageSnapshot}:{})});
  pageSnapshot=rowPage.snapshot;
  const ed=rowPage.edition;
  $('edition-summary').textContent=ed.rowCount+' retained opportunities · '+(ed.coverage.searchComplete?'Complete source search':'Partial source search')+
    ' · '+(ed.coverage.detailsComplete?'All notice details retained':(ed.coverage.detailCount??0)+' notice details retained')+
    ' · Saved '+stamp(ed.createdAt);
  $('opportunity-rows').innerHTML=rowPage.items.length?rowPage.items.map(row=>
    '<tr'+(opened?.opportunity.opportunity_id===row.opportunity_id?' class="selected-row"':'')+'><td><input type="checkbox" data-select="'+escape(row.opportunity_id)+'" aria-label="Select '+escape(row.opportunity_number)+'" '+(selected.has(row.opportunity_id)?'checked':'')+'></td>'+
    '<td><button class="link opportunity-title" data-opportunity="'+escape(row.opportunity_id)+'">'+escape(row.title)+'</button>'+
    '<div class="row-meta">'+escape(row.opportunity_number)+' · '+escape(row.status)+'</div></td>'+
    '<td>'+escape(row.agency_name??row.agency_code)+'</td><td>'+escape(row.closing_date??(row.document_type==='forecast'?'Forecast':'Unreported'))+'</td>'+
    '<td>'+(row.review?'<span class="badge">'+escape(row.review.status)+'</span><div class="row-meta">'+escape(row.review.owner)+'</div>':'—')+'</td></tr>'
  ).join(''):'<tr><td colspan="5" class="empty">No retained opportunities match these filters.</td></tr>';
  $('page-summary').textContent=(rowPage.total?pageOffset+1:0)+'–'+Math.min(pageOffset+25,rowPage.total)+' of '+rowPage.total;
  $('previous-page').disabled=pageOffset===0;$('next-page').disabled=rowPage.nextOffset===null;renderSelection();
}
function renderSelection(){
  $('selected-count').textContent=selected.size+' selected';$('save-selection').disabled=selected.size===0;
  $('select-page').checked=!!rowPage?.items.length&&rowPage.items.every(row=>selected.has(row.opportunity_id));
}
function field(name,value){
  if(name==='status')return '<label>'+reviewLabels[name]+'<select name="'+name+'">'+
    ['researching','qualified','preparing','ready','passed'].map(status=>'<option value="'+status+'" '+(status===(value||'researching')?'selected':'')+'>'+status+'</option>').join('')+'</select></label>';
  return '<label>'+reviewLabels[name]+(shortFields.has(name)?'<input name="'+name+'" maxlength="32000" value="'+escape(value)+'">':
    '<textarea name="'+name+'" rows="'+(name==='workshare'||name==='deliverables'||name==='acceptance'?'5':'3')+'" maxlength="32000">'+escape(value)+'</textarea>')+'</label>';
}
function linksOf(value){
  const found=[];
  const visit=(node,parentLabel='Document')=>{
    if(!node||typeof node!=='object')return;
    if(Array.isArray(node)){node.forEach(item=>visit(item,parentLabel));return;}
    const name=node.fileName??node.name??node.synopsisAttachmentFileName??node.documentName??node.description??parentLabel;
    for(const [key,item]of Object.entries(node)){
      if(typeof item==='string'&&/url|uri|link/i.test(key)){
        try{const url=new URL(item);if(url.protocol==='https:')found.push({name:String(name),url:url.href});}catch{}
      }else if(item&&typeof item==='object')visit(item,name);
    }
  };visit(value);return found;
}
function renderOpportunity(){
  const row=opened.opportunity,review=opened.review,fields=[
    ['Published closing date',row.closing_date_raw??row.closing_date],
    ['Reported award ceiling',row.award_ceiling_raw],['Reported award floor',row.award_floor_raw],
    ['Reported total funding',row.estimated_funding_raw],['Forecast response',row.forecast_response_date_raw],
    ['Cost sharing',row.cost_sharing===null?null:row.cost_sharing?'Required':'No']
  ];
  const sourceLinks=linksOf(row.attachment_manifest);
  $('opportunity-detail').innerHTML='<div class="toolbar"><span class="badge">'+escape(row.status)+'</span><span class="badge">'+escape(row.document_type)+'</span></div>'+
    '<h2>'+escape(row.title)+'</h2><p class="muted">'+escape(row.opportunity_number)+' · '+escape(row.agency_name)+'</p>'+
    '<p><a href="'+escape(row.source_url)+'" target="_blank" rel="noopener noreferrer">Open official notice</a></p>'+
    '<div class="facts">'+fields.map(([label,value])=>'<div class="fact"><span class="fact-label">'+escape(label)+'</span><strong>'+escape(textValue(value))+'</strong></div>').join('')+'</div>'+
    (row.closing_date_description?'<p class="prose">'+escape(row.closing_date_description)+'</p>':'')+
    '<details open><summary>Original description and eligibility</summary><div class="prose">'+escape(row.description??'Description unreported.')+'</div>'+
    '<h3>Eligible applicants</h3><div class="prose">'+escape(row.eligibility?.narrative??'Narrative unreported.')+'</div>'+
    '<pre>'+escape(json(row.eligibility?.types??[]))+'</pre></details>'+
    '<details open><summary>Qualification and workshare'+(review?' · revision '+review.revision:'')+'</summary>'+
    (review&&review.editionSha256!==opened.edition.sha256?'<p class="muted">This qualification was saved against another retained edition. Review the current notice and save a new revision.</p>':'')+
    '<form id="review-form" class="form-stack">'+reviewFields.map(name=>field(name,review?.data[name]??'')).join('')+
    '<button class="primary">Save qualification and workshare</button></form>'+
    '<div class="toolbar"><button data-workshare="md" '+(!review?'disabled':'')+'>Export Markdown</button><button data-workshare="html" '+(!review?'disabled':'')+'>Export HTML</button></div></details>'+
    '<details><summary>Dates and funding as published</summary><pre>'+escape(json({dates:row.dates,funding:row.funding,assistanceListings:row.assistance_listings}))+'</pre></details>'+
    '<details><summary>Attachments and application packages</summary>'+
    (sourceLinks.length?'<ul class="source-links">'+sourceLinks.map(link=>'<li><a href="'+escape(link.url)+'" target="_blank" rel="noopener noreferrer">'+escape(link.name)+'</a></li>').join('')+'</ul>':'')+
    '<pre>'+escape(json({attachments:row.attachment_manifest,packages:row.package_manifest}))+'</pre></details>'+
    '<details><summary>Original revision history · '+(row.revision_history?.length??0)+'</summary><pre>'+escape(json(row.revision_history??[]))+'</pre></details>'+
    '<details><summary>Saved qualification history · '+(review?.history?.length??0)+'</summary><pre>'+escape(json(review?.history??[]))+'</pre></details>'+
    '<details><summary>Retained source</summary><pre>'+escape(json({observedAt:row.source_observed_at,source:row.source,notes:row.warnings,edition:opened.edition.id}))+'</pre></details>';
  $('review-form').addEventListener('input',()=>dirty=true);
  $('review-form').addEventListener('submit',event=>{
    event.preventDefault();void run(async()=>{
      const review=Object.fromEntries(new FormData(event.target));
      await action('review.save',{requestId:id(),editionId,opportunityId:row.opportunity_id,expectedRevision:opened.review?.revision??0,review},true);
      dirty=false;pageSnapshot=null;await openOpportunity(row.opportunity_id);await refresh();
    },'Qualification and workshare saved.');
  });
  $('workshare-selection').textContent='Selected workshare: '+row.opportunity_number+' · '+row.title;
}
async function openOpportunity(opportunityId){
  if(dirty&&!confirm('Discard the unsaved qualification edits?'))return;
  opened=await action('opportunity.read',{editionId,opportunityId});dirty=false;renderOpportunity();await loadRows();
}
async function exportAndDownload(input){
  const result=await action('export.create',input);
  await refresh({load:false});await download(result.id);return result;
}
async function download(exportId){
  const response=await fetch('/api/exports/'+exportId,{headers:{Authorization:'Bearer '+session},credentials:'omit',cache:'no-store'});
  if(!response.ok){let problem;try{problem=await response.json();}catch{}throw Error(problem?.error?.message??'The export download failed.');}
  const blob=await response.blob(),name=response.headers.get('content-disposition')?.match(/filename="([^"]+)"/)?.[1]??exportId+'.json';
  const url=URL.createObjectURL(blob),anchor=document.createElement('a');anchor.href=url;anchor.download=name;anchor.click();setTimeout(()=>URL.revokeObjectURL(url),10000);
}
async function loadComparison(offset=0){
  comparisonOffset=offset;
  comparison=await action('edition.compare',{before:$('compare-before').value,after:$('compare-after').value,offset,limit:25});
  $('comparison').innerHTML='<p><strong>'+comparison.counts.changed+'</strong> changed · <strong>'+comparison.counts.added+
    '</strong> added to the later edition · <strong>'+comparison.counts.absent+'</strong> absent from the later edition</p>'+
    '<p class="muted">'+escape(comparison.interpretation)+'</p>'+
    comparison.changes.items.map(change=>'<article class="change"><h3>'+escape(change.title)+'</h3><p><span class="badge">'+escape(change.kind.replaceAll('_',' '))+'</span>'+
      (change.requiresReview?' <span class="badge">Review requirements</span>':'')+'</p>'+
      (change.fields?'<table><thead><tr><th>Field</th><th>Earlier</th><th>Later</th></tr></thead><tbody>'+change.fields.map(value=>
        '<tr><th>'+escape(value.field)+'</th><td>'+escape(textValue(value.before))+'</td><td>'+escape(textValue(value.after))+'</td></tr>').join('')+'</tbody></table>':
        '<pre>'+escape(json(change.after??change.before))+'</pre>')+'</article>').join('')+
    '<div class="pagination"><button data-compare-offset="'+Math.max(0,offset-25)+'" '+(!offset?'disabled':'')+'>Previous</button><span>'+
    (comparison.changes.total?offset+1:0)+'–'+Math.min(offset+25,comparison.changes.total)+' of '+comparison.changes.total+
    '</span><button data-compare-offset="'+(offset+25)+'" '+(comparison.changes.nextOffset===null?'disabled':'')+'>Next</button></div>';
}
function currentPublisherInput(actionName){
  const target=publisherState?.target,versions=target?.versions,draft=publisherState?.drafts?.candidates?.at(-1);
  const revision={expectedSnapshot:versions?.current??'',expectedRevision:versions?.revision??0};
  const snapshot=versions?.current??'';
  const release=publisherState?.releases,session=publisherState?.sessions?.at(-1);
  const buyer=publisherState?.drafts?.buyers?.at(-1);
  const map={
    'publisher.status':{},
    'publisher.prepare':{merchantId:state.merchants.filter(value=>value.configured).at(-1)?.id??''},
    'publisher.preview':{target:draft?'draft:'+draft.id:snapshot,query:'limit=10'},
    'publisher.reviewDraft':{draftId:draft?.id??'',...revision},
    'publisher.publish':{draftId:draft?.id??'',...revision},
    'publisher.activateSnapshot':{snapshot,...revision},'publisher.collect':{},
    'publisher.release.stage':{draftId:draft?.id??'',id:'grant-edition-'+new Date().toISOString().slice(0,10),label:'Federal grant opportunities',runtime:{port:0}},
    'publisher.release.inspect':{id:release?.active?.id??release?.active??''},
    'publisher.release.activate':{id:release?.releases?.at(-1)?.id??'',expectedGeneration:release?.generation??0},
    'publisher.release.rollback':{expectedGeneration:release?.generation??0},
    'publisher.release.start':{expectedGeneration:release?.generation??0},'publisher.release.stop':{},
    'publisher.buyer.review':{snapshot,query:'limit=25'},
    'publisher.buyer.prepare':{review:buyerReview??{},intentId:'grants-'+id(),acceptIndex:0,offerSha256:buyerReview?.offerSha256??''},
    'publisher.buyer.session':{buyerId:buyer?.id??'',workspaceId:state.buyerWorkspaces?.[0]??'',maxPages:100,maxTotalAtomic:'0',maxRows:1000000,maxPageBytes:8388608},
    'publisher.buyer.run':{id:session?.id??''},'publisher.buyer.recover':{id:session?.id??''},
    'publisher.buyer.account':{id:session?.id??''},'publisher.buyer.export':{id:session?.id??''},
    'publisher.export':{kind:'session-manifest',id:session?.id??''}
  };
  return map[actionName]??{};
}
async function publisherAction(actionName,input){
  const result=await action(actionName,input);
  if(actionName==='publisher.status')publisherState=result;
  else if(result.state)publisherState=result.state;
  if(actionName==='publisher.buyer.review')buyerReview=result.result;
  $('publisher-result').textContent=json(result);await refresh({load:false});return result;
}
function fillQuery(){
  queryId=$('query-existing').value||null;
  const query=state.queries.find(value=>value.id===queryId);queryRevision=query?.revision??0;
  if(!query)return;
  $('query-name').value=query.name;$('query-keyword').value=query.definition.keyword;$('query-number').value=query.definition.opportunityNumber;
  for(const node of document.querySelectorAll('input[name=statuses]'))node.checked=query.definition.statuses.includes(node.value);
  for(const key of ['agencies','eligibilities','fundingCategories','fundingInstruments'])$('query-'+key).value=query.definition[key].join('|');
  $('query-aln').value=query.definition.aln;$('query-pageSize').value=query.definition.pageSize;
}
document.querySelectorAll('nav [data-view]').forEach(button=>button.addEventListener('click',()=>switchView(button.dataset.view)));
document.addEventListener('click',event=>{
  const button=event.target.closest('button');if(!button||button.disabled)return;
  const data=button.dataset;
  if(data.openView)return switchView(data.openView);
  if(data.opportunity)return void run(()=>openOpportunity(data.opportunity));
  if(data.download)return void run(()=>download(data.download),'Complete file downloaded.');
  if(data.edition)return void run(async()=>{if(chooseEdition(data.edition)){switchView('opportunities');await loadRows();}});
  if(data.pause)return void run(async()=>{await action('capture.pause',{captureId:data.pause});await refresh();},'Original capture paused.');
  if(data.resume)return void run(async()=>{await action('capture.start',{requestId:id(),captureId:data.resume},true);await refresh();},'Original capture resumed.');
  if(data.captureEdition)return void run(async()=>{const source=state.captures.find(value=>value.id===data.captureEdition);
    const saved=await action('edition.create',{requestId:id(),captureId:source.id,name:source.name+' · saved edition'},true);
    await refresh({load:false});if(chooseEdition(saved.id)){switchView('opportunities');await loadRows();}},'Original edition saved.');
  if(data.captureExport)return void run(()=>exportAndDownload({kind:'capture',captureId:data.captureExport}));
  if(data.merchantExport)return void run(()=>exportAndDownload({kind:'merchant',merchantId:data.merchantExport}));
  if(data.publisherPrepare)return void run(async()=>{switchView('publishing');await publisherAction('publisher.prepare',{merchantId:data.publisherPrepare});},'Native dataset draft prepared.');
  if(data.workshare)return void run(()=>exportAndDownload({kind:'workshare-'+data.workshare,editionId,opportunityId:opened.opportunity.opportunity_id}));
  if(data.compareOffset!==undefined)return void run(()=>loadComparison(Number(data.compareOffset)));
});
document.addEventListener('change',event=>{
  if(event.target.dataset.select){event.target.checked?selected.add(event.target.dataset.select):selected.delete(event.target.dataset.select);renderSelection();}
});
$('select-page').addEventListener('change',event=>{for(const row of rowPage?.items??[])event.target.checked?selected.add(row.opportunity_id):selected.delete(row.opportunity_id);void run(loadRows);});
$('edition').addEventListener('change',()=>void run(async()=>{if(chooseEdition($('edition').value))await loadRows();else $('edition').value=editionId;}));
$('filter-rows').addEventListener('click',()=>void run(async()=>{pageOffset=0;pageSnapshot=null;await loadRows();}));
$('row-search').addEventListener('keydown',event=>{if(event.key==='Enter')$('filter-rows').click();});
$('previous-page').addEventListener('click',()=>void run(async()=>{pageOffset=Math.max(0,pageOffset-25);await loadRows();}));
$('next-page').addEventListener('click',()=>void run(async()=>{pageOffset=rowPage.nextOffset;await loadRows();}));
$('refresh').addEventListener('click',()=>void run(()=>refresh(),'Workspace refreshed.'));
$('backup').addEventListener('click',()=>void run(()=>exportAndDownload({kind:'workspace'}),'Complete research workspace exported.'));
$('save-selection').addEventListener('click',()=>void run(async()=>{
  const source=state.editions.find(value=>value.id===editionId);
  const result=await action('edition.create',{requestId:id(),captureId:source.captureId,sourceEditionId:editionId,
    parentId:editionId,name:$('selection-name').value.trim()||'Priority grant opportunities',opportunityIds:[...selected]},true);
  await refresh({load:false});if(chooseEdition(result.id))await loadRows();
},'Selected opportunity edition saved.'));
$('query-existing').addEventListener('change',fillQuery);
$('query-form').addEventListener('submit',event=>{
  event.preventDefault();const capture=event.submitter?.name==='capture';
  void run(async()=>{
    const definition={keyword:$('query-keyword').value,opportunityNumber:$('query-number').value,
      statuses:[...document.querySelectorAll('input[name=statuses]:checked')].map(node=>node.value),
      agencies:split($('query-agencies').value),eligibilities:split($('query-eligibilities').value),
      fundingCategories:split($('query-fundingCategories').value),fundingInstruments:split($('query-fundingInstruments').value),
      aln:$('query-aln').value,pageSize:Number($('query-pageSize').value)};
    const query=await action('query.save',{requestId:id(),...(queryId?{id:queryId}:{}),expectedRevision:queryRevision,name:$('query-name').value,definition},true);
    queryId=query.id;queryRevision=query.revision;
    if(capture)await action('capture.start',{requestId:id(),operationId:'grants-'+id(),queryId:query.id,expectedRevision:query.revision},true);
    await refresh();$('query-existing').value=query.id;
  },capture?'Saved search acquisition started.':'Search saved.');
});
$('compare-form').addEventListener('submit',event=>{event.preventDefault();void run(()=>loadComparison(0));});
$('export-comparison').addEventListener('click',()=>void run(()=>exportAndDownload({kind:'comparison',before:$('compare-before').value,after:$('compare-after').value})));
$('merchant-form').addEventListener('submit',event=>{
  event.preventDefault();void run(async()=>{
    const payment=$('merchant-payment').value.trim(),origin=$('merchant-origin').value.trim();
    const input={requestId:id(),editionId:$('merchant-edition').value,defaultLimit:Number($('merchant-default').value),maxLimit:Number($('merchant-max').value)};
    if(payment||origin){input.payment=JSON.parse(payment);input.origin=origin;input.path=$('merchant-path').value;}
    await action('merchant.create',input,true);await refresh({load:false});
  },'Complete merchant dataset prepared.');
});
$('preview-form').addEventListener('submit',event=>{event.preventDefault();void run(async()=>{
  const result=await action('merchant.preview',{merchantId:$('preview-merchant').value,query:JSON.parse($('preview-query').value)});
  $('preview-result').textContent=json(result);
});});
$('publisher-form').addEventListener('submit',event=>{event.preventDefault();void run(()=>publisherAction($('publisher-action').value,JSON.parse($('publisher-input').value)));});
$('publisher-template').addEventListener('click',()=>void run(async()=>{
  await publisherAction('publisher.status',{});$('publisher-input').value=json(currentPublisherInput($('publisher-action').value));
}));
$('export-form').addEventListener('submit',event=>{event.preventDefault();void run(()=>exportAndDownload({kind:$('export-kind').value,
  editionId:$('export-edition').value,captureId:$('export-capture').value,merchantId:$('export-merchant').value,
  opportunityId:opened?.opportunity.opportunity_id,includeReviews:true}));});
$('receive-form').addEventListener('submit',event=>{
  event.preventDefault();void run(async()=>{
    const file=$('receive-file').files[0];if(!file)throw Error('Choose the complete portable JSON file.');
    if(file.size>256*1024*1024)throw Error('Use the native CLI for files larger than 256 MiB.');
    const packet=JSON.parse(await file.text()),kind=$('receive-kind').value;
    const result=await action(kind==='workspace'?'workspace.restore':kind==='edition'?'edition.receive':'capture.import',
      {requestId:id(),packet,name:$('receive-name').value},false);
    await refresh();
    if(kind==='capture'){
      const saved=await action('edition.create',{requestId:id(),captureId:result.id,name:$('receive-name').value},true);
      await refresh({load:false});if(chooseEdition(saved.id)){switchView('opportunities');await loadRows();}
    }else if(kind==='edition'&&result.id){if(chooseEdition(result.id)){switchView('opportunities');await loadRows();}}
  },'Original work received and reopened.');
});
$('retry-action').addEventListener('click',()=>void run(async()=>{
  const pending=sessionStorage.getItem('grants-pending');if(!pending)return;
  const payload=JSON.parse(pending);await action(payload.action,payload.input,true);await refresh();
},'Original action response received.'));
window.addEventListener('beforeunload',event=>{if(dirty){event.preventDefault();event.returnValue='';}});
$('pending').hidden=!sessionStorage.getItem('grants-pending');
if(!session)notice('Open the local workspace URL printed by the native serve command.',true);
else void run(()=>refresh());
setInterval(()=>{
  if(!state?.jobs.length||polling||document.hidden)return;
  polling=true;refresh({load:false}).catch(error=>notice(error.message,true)).finally(()=>polling=false);
},3000);
