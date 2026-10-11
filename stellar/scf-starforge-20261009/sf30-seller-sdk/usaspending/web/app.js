'use strict';
const $=id=>document.getElementById(id),esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const key='award-research-token:'+location.origin,token=location.hash.slice(1)||sessionStorage.getItem(key)||'';
if(location.hash){sessionStorage.setItem(key,token);history.replaceState(null,'',location.pathname);}
const state={data:null,edition:null,view:'overview',page:1,rows:[],total:0,selected:new Set(),award:null,loading:false,polling:false};
const fmt=v=>v===null||v===undefined||v===''?'—':String(v);
const time=v=>v?String(v).replace('T',' ').replace(/\.\d+Z$/,' UTC'):'—';
function money(v){if(v===null||v===undefined)return '—';const s=String(v),[a,b='']=s.replace(/^-/,'').split('.');return(s[0]==='-'?'−$':'$')+a.replace(/\B(?=(\d{3})+(?!\d))/g,',')+'.'+b.padEnd(2,'0');}
function notice(message){$('notice').textContent=message;$('notice').hidden=!message;const dialog=document.querySelector('dialog[open]');if(dialog){let line=dialog.querySelector('[data-dialog-notice]');if(!line){line=document.createElement('p');line.dataset.dialogNotice='true';line.setAttribute('role','alert');dialog.prepend(line);}line.textContent=message;line.hidden=!message;}}
async function api(path,body){
  const response=await fetch(path,{method:body===undefined?'GET':'POST',headers:{'x-research-token':token,...(body===undefined?{}:{'content-type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)})});
  const value=await response.json();if(!response.ok)throw Object.assign(new Error(value.message??value.error??'Request failed'),value);return value;
}
function guarded(fn){return async event=>{try{notice('');await fn(event);}catch(error){notice(error.message);}};}
async function download(path,fallback){
  const response=await fetch(path,{headers:{'x-research-token':token}});if(!response.ok){const v=await response.json();throw new Error(v.message??v.error);}
  const blob=await response.blob(),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=/filename="([^"]+)"/.exec(response.headers.get('content-disposition')??'')?.[1]??fallback;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
function activeEdition(){if(!state.edition)throw new Error('Choose a retained edition first.');return state.edition;}
function chosen(){return state.data?.editions.find(e=>e.id===state.edition);}
function pill(value){return '<span class="pill">'+esc(String(value).replaceAll('_',' '))+'</span>';}
function table(headers,rows){return '<table><thead><tr>'+headers.map(h=>'<th>'+esc(h)+'</th>').join('')+'</tr></thead><tbody>'+rows.map(row=>'<tr>'+row.map(cell=>'<td>'+cell+'</td>').join('')+'</tr>').join('')+'</tbody></table>';}
function editionLabel(e){return e.name+' · '+e.row_count+' awards · '+time(e.created_at);}
function renderOptions(){
  const options=state.data.editions.map(e=>'<option value="'+esc(e.id)+'">'+esc(editionLabel(e))+'</option>').join('');
  $('edition').innerHTML='<option value="">Choose a retained edition</option>'+options;$('edition').value=state.edition??'';
  for(const id of ['compare-before','compare-after']){const old=$(id).value;$(id).innerHTML=options;if(state.data.editions.some(e=>e.id===old))$(id).value=old;else if(id==='compare-before'&&state.data.editions.length>1)$(id).value=state.data.editions[1].id;}
  const packages=state.data.publications.filter(p=>p.data.merchantId);$('preview-package').innerHTML=packages.map(p=>'<option value="'+esc(p.data.merchantId)+'">'+esc(p.data.merchantId+' · '+p.data.rows+' rows')+'</option>').join('');
  $('export-edition').disabled=$('export-csv').disabled=!state.edition;
}
async function refresh(){
  if(state.loading)return;state.loading=true;
  try{
    state.data=await api('/api/state');
    if(!state.data.editions.some(e=>e.id===state.edition)){const stored=localStorage.getItem('award-edition:'+state.data.id);state.edition=state.data.editions.some(e=>e.id===stored)?stored:state.data.editions.find(e=>e.row_count>1)?.id??state.data.editions[0]?.id??null;}
    $('connection').textContent=state.data.active.length?state.data.active.length+' source operation(s) active':'Workspace connected';
    $('workspace-id').textContent=state.data.id;renderOptions();renderOverview();renderQueries();renderCaptures();renderShortlist();renderMerchants();
    if(state.view==='overview')await renderCoverage();
    if(state.view==='history')await renderHistory();
    if(state.view==='delivery')await renderReceiving();
  }finally{state.loading=false;}
}
function renderOverview(){
  const d=state.data;let prepared=d.reviews.filter(r=>['workshare_prepared','owner_contact'].includes(r.data.status)).length;
  $('metrics').innerHTML=[['Saved cohorts',d.queries.length],['Retained editions',d.editions.length],['Qualified workshares',prepared],['Source operations',d.captures.length]].map(([label,n])=>'<div class="metric"><strong>'+n+'</strong><span>'+label+'</span></div>').join('');
  $('recent-editions').innerHTML=d.editions.length?table(['Edition','Awards','Source kind','Retained',''],d.editions.slice(0,12).map(e=>[esc(e.name),String(e.row_count),pill(e.kind),esc(time(e.created_at)),'<button data-edition="'+esc(e.id)+'">Open</button>'])):'<div class="empty">Save a cohort and capture its first source edition.</div>';
  $('jobs').innerHTML=d.jobs.length?d.jobs.slice(-8).reverse().map(j=>'<div class="record"><h3>'+esc(j.type.replaceAll('_',' '))+' '+pill(j.status)+'</h3><p>'+esc(time(j.startedAt))+'</p>'+(j.error?'<p>'+esc(j.error.message)+'</p>':'')+(j.status==='running'?'<button data-cancel-job="'+esc(j.id)+'">Pause operation</button>':'')+(j.result?.editionId?'<button data-edition="'+esc(j.result.editionId)+'">Open result</button>':'')+'</div>').join(''):'<div class="empty">No active source work.</div>';
}
async function renderCoverage(){
  if(!state.edition){$('coverage').innerHTML='<div class="empty">Choose an edition.</div>';return;}
  const {coverage:c,warnings}=await api('/api/coverage?edition='+encodeURIComponent(state.edition));
  $('coverage').innerHTML='<p>'+pill(c.state)+' · '+c.rowCount+' selected awards</p><dl class="source-grid">'+[
    ['Original provider cohort',c.sourceCapture?c.sourceCapture.uniqueRows+' awards / '+c.sourceCapture.pages+' pages':'Received or individual source view'],
    ['Detailed award records',c.detailedRows],['Missing recipient UEI',c.missingRecipientUei],['Missing outlays',c.missingOutlays],['First source observation',time(c.firstObservedAt)],['Last source observation',time(c.lastObservedAt)]
  ].map(([a,b])=>'<dt>'+esc(a)+'</dt><dd>'+esc(b)+'</dd>').join('')+'</dl>'+warnings.map(w=>'<p class="meta">'+esc(w)+'</p>').join('');
}
function go(view){
  state.view=view;document.querySelectorAll('main>section').forEach(s=>s.hidden=s.id!=='view-'+view);document.querySelectorAll('nav button').forEach(b=>b.classList.toggle('active',b.dataset.view===view));
  if(view==='awards')return loadAwards();if(view==='overview')return renderCoverage();if(view==='history')return renderHistory();if(view==='delivery')return renderReceiving();return Promise.resolve();
}
async function chooseEdition(id){state.edition=id;state.page=1;state.selected.clear();localStorage.setItem('award-edition:'+state.data.id,id);renderOptions();await go('awards');}
function listLines(id){return $(id).value.split(/\r?\n/).map(s=>s.trim()).filter(Boolean);}
function codes(id){return $(id).value.split(/[\s,]+/).filter(Boolean);}
function agencyRow(a={type:'awarding',tier:'toptier',name:''}){
  const row=document.createElement('div');row.className='agency-row';
  row.innerHTML='<div class="two-fields"><label>Role<select class="a-type"><option value="awarding">Awarding</option><option value="funding">Funding</option></select></label><label>Level<select class="a-tier"><option value="toptier">Top-level agency</option><option value="subtier">Sub-agency</option></select></label></div><label>Name<input class="a-name"></label><label>Parent agency for a sub-agency<input class="a-parent"></label><button type="button" class="remove-agency">Remove</button>';
  row.querySelector('.a-type').value=a.type;row.querySelector('.a-tier').value=a.tier;row.querySelector('.a-name').value=a.name;row.querySelector('.a-parent').value=a.toptier_name??'';$('agency-rules').append(row);
}
function editQuery(q){
  const d=q?.definition??{},today=new Date().toISOString().slice(0,10);
  $('q-id').value=q?.id??'';$('q-revision').value=q?.revision??0;
  const values={name:d.name??'',start:d.startDate??today,end:d.endDate??today,'date-type':d.dateType??'new_awards_only',keywords:(d.keywords??[]).join('\n'),description:d.description??'',recipient:(d.recipient??[]).join('\n'),naics:(d.naics??[]).join(', '),psc:(d.psc??[]).join(', '),min:d.minimumAwardUsd??'',max:d.maximumAwardUsd??'','award-ids':(d.awardIds??[]).join('\n'),page:d.pageSize??50,capacity:d.maxRows??50000};
  for(const [id,value]of Object.entries(values))$('q-'+id).value=value;
  document.querySelectorAll('#q-types input').forEach(c=>c.checked=(d.awardTypes??['A','B','C','D']).includes(c.value));
  $('agency-rules').innerHTML='';for(const a of d.agencies??[])agencyRow(a);
  $('query-heading').textContent=q?'Edit saved cohort':'Define a cohort';$('query-state').textContent=q?'Revision '+q.revision:'';
}
function queryDefinition(){
  const agencies=[...document.querySelectorAll('.agency-row')].map(row=>({type:row.querySelector('.a-type').value,tier:row.querySelector('.a-tier').value,name:row.querySelector('.a-name').value.trim(),...(row.querySelector('.a-parent').value.trim()?{toptier_name:row.querySelector('.a-parent').value.trim()}:{})}));
  const d={name:$('q-name').value,startDate:$('q-start').value,endDate:$('q-end').value,dateType:$('q-date-type').value,keywords:listLines('q-keywords'),description:$('q-description').value,recipient:listLines('q-recipient'),naics:codes('q-naics'),psc:codes('q-psc'),awardIds:listLines('q-award-ids'),agencies,awardTypes:[...document.querySelectorAll('#q-types input:checked')].map(c=>c.value),pageSize:Number($('q-page').value),maxRows:Number($('q-capacity').value)};
  for(const [id,k]of [['q-min','minimumAwardUsd'],['q-max','maximumAwardUsd']])if($(id).value.trim())d[k]=Number($(id).value);return d;
}
function renderQueries(){
  $('queries').innerHTML=state.data.queries.length?state.data.queries.map(q=>'<div class="record"><h3>'+esc(q.definition.name)+'</h3><p>'+esc(q.definition.startDate+' → '+q.definition.endDate+' · '+q.definition.dateType)+'</p><p>'+esc(q.definition.keywords.join(' / '))+'</p><div class="actions"><button data-capture-query="'+esc(q.id)+'" class="primary">Capture new edition</button><button data-edit-query="'+esc(q.id)+'">Edit revision '+q.revision+'</button></div></div>').join(''):'<div class="empty">Your saved cohorts appear here.</div>';
}
function renderCaptures(){
  $('captures').innerHTML=state.data.captures.length?state.data.captures.slice(0,25).map(c=>{
    const running=state.data.active.includes(c.id);
    return '<div class="record"><h3>'+esc(c.definition.name)+' '+pill(c.status)+'</h3><p>'+c.page_count+' original pages · '+c.row_count+' returned records · '+c.duplicate_count+' repeated identities</p><p class="mono">'+esc(c.id)+'</p>'+(c.error?'<p>'+esc(c.error.message)+(c.error.retryAt?' · retry after '+esc(c.error.retryAt):'')+'</p>':'')+'<div class="actions">'+(c.edition_id?'<button data-edition="'+esc(c.edition_id)+'">Open edition</button>':running?'<button data-pause-capture="'+esc(c.id)+'">Pause</button>':'<button data-resume="'+esc(c.id)+'">Resume retained capture</button>')+(c.page_count?'<button data-source-capture="'+esc(c.id)+'">Original page 1</button>':'')+'</div>'+(!c.edition_id&&!running?'<form class="capacity-row" data-capacity="'+esc(c.id)+'"><input type="number" min="'+Math.max(1,c.row_count)+'" max="250000" value="'+c.definition.maxRows+'" aria-label="Capture row capacity"><button type="submit">Set capacity</button></form>':'')+'</div>';
  }).join(''):'<div class="empty">Accepted pages remain available after an interruption.</div>';
}
function filters(){return {search:$('f-search').value,recipientUei:$('f-uei').value,agency:$('f-agency').value,naics:$('f-naics').value,psc:$('f-psc').value};}
async function loadAwards(){
  if(!state.edition){$('award-table').innerHTML='<div class="empty">Choose or capture an edition.</div>';return;}
  const params=new URLSearchParams({edition:state.edition,page:String(state.page),limit:'50',...filters()});
  const [result,overview]=await Promise.all([api('/api/rows?'+params),api('/api/overview?edition='+encodeURIComponent(state.edition))]);
  state.rows=result.rows;state.total=result.total;
  $('award-status').textContent=result.total+' matching awards · '+state.selected.size+' selected · '+chosen().kind.replaceAll('_',' ');
  $('award-table').innerHTML=table(['Select','Prime / UEI','Award / agency','Signed / performance end','Award amount','Details'],result.rows.map(r=>[
    '<input type="checkbox" data-select-award="'+esc(r.award_key)+'" aria-label="Select '+esc(r.piid)+'" '+(state.selected.has(r.award_key)?'checked':'')+'>',
    esc(fmt(r.recipient_name))+'<span class="meta mono">'+esc(fmt(r.recipient_uei))+'</span>',
    esc(fmt(r.piid))+'<span class="meta">'+esc(fmt(r.awarding_agency))+'</span>',
    esc(fmt(r.signed_date))+'<span class="meta">'+esc(fmt(r.performance_end))+'</span>',
    '<span class="amount">'+esc(money(r.award_amount_usd))+'</span>',
    '<button data-award="'+esc(r.award_key)+'">Research</button><span class="meta">'+esc(r.source_kind.replaceAll('_',' '))+'</span>'
  ]));
  $('page-state').textContent='Page '+result.page+' · '+result.rows.length+' of '+result.total;$('previous-page').disabled=state.page===1;$('next-page').disabled=!result.hasNext;
  $('recipient-groups').innerHTML=table(['Prime','Recipient UEI','Awards','Known award amount',''],overview.groups.map(g=>[esc(fmt(g.name)),'<span class="mono">'+esc(fmt(g.uei))+'</span>',String(g.awardCount),esc(money(g.knownAwardAmountUsd)),g.uei?'<button data-filter-uei="'+esc(g.uei)+'">Select prime</button>':'']));
}
async function openAward(key,edition=state.edition){
  if(edition!==state.edition){state.edition=edition;renderOptions();}
  state.award=await api('/api/award?edition='+encodeURIComponent(activeEdition())+'&key='+encodeURIComponent(key));
  const a=state.award,r=state.data.reviews.find(r=>r.award_key===key),v=r?.data??{};
  $('award-title').textContent=fmt(a.recipient_name);$('award-subtitle').textContent=fmt(a.piid)+' · '+a.award_key;
  const fields=[['Recipient UEI',a.recipient_uei],['Recipient identity',a.recipient_id],['Parent recipient',a.parent_recipient_name],['Parent UEI',a.parent_recipient_uei],['Parent award',a.parent_piid],['Awarding agency',a.awarding_agency],['Sub-agency',a.awarding_subagency],['Funding agency',a.funding_agency],['Signed',a.signed_date],['Performance start',a.performance_start],['Performance end',a.performance_end],['Potential end',a.potential_end],['Award amount',money(a.award_amount_usd)],['Total obligations',money(a.total_obligation_usd)],['Exercised value',money(a.exercised_usd)],['All-options value',money(a.potential_usd)],['Outlays',money(a.outlays_usd)],['NAICS',a.naics],['PSC',a.psc],['Set aside',a.set_aside],['Subcontracting plan',a.subcontracting_plan],['Observed',time(a.source_observed_at)]];
  $('award-detail').innerHTML='<dl class="source-grid">'+fields.map(([k,v])=>'<dt>'+esc(k)+'</dt><dd>'+esc(fmt(v))+'</dd>').join('')+'</dl><p class="source-description">'+esc(a.description)+'</p><a href="'+esc(a.source_url)+'" target="_blank" rel="noreferrer">Open original public award ↗</a>';
  $('award-raw').textContent=JSON.stringify(a.raw??a,null,2);$('r-revision').value=r?.revision??0;
  const mapping={status:v.status??'researching',fit:v.fit??'',urls:(v.businessFitUrls??[]).map(s=>s.url).join('\n'),observed:(v.businessFitUrls??[])[0]?.observedAt??'',workshare:v.workshare??'',deliverables:v.deliverables??'',acceptance:v.acceptance??'',constraints:v.constraints??'',fee:v.feeUsd??'',days:v.durationDays??'',owner:v.owner??'',contact:v.primeContact??'',case:v.caseUrl??'',next:v.nextAction??'','next-date':v.nextActionDate??'',notes:v.notes??''};
  for(const [k,value]of Object.entries(mapping))$('r-'+k).value=value;
  $('review-source-state').textContent=r?(r.row_sha256===a.row_sha256?'This review references the selected source row.':'The source row differs from the last review. Saving reopens it against this edition.'):'New analyst record for this original award identity.';
  if(!$('award-dialog').open)$('award-dialog').showModal();
}
function renderShortlist(){
  $('shortlist').innerHTML=state.data.reviews.length?table(['Award','Disposition','Owner','Proposed fee','Workshare','Reviewed',''],state.data.reviews.map(r=>[
    '<span class="mono">'+esc(r.award_key)+'</span>',pill(r.data.status),esc(r.data.owner),esc(r.data.feeUsd?money(r.data.feeUsd):'—'),esc((r.data.workshare??'').slice(0,170)),esc(time(r.updated_at))+'<span class="meta">Revision '+r.revision+'</span>','<button data-review-key="'+esc(r.award_key)+'" data-review-edition="'+esc(r.edition_id)+'">Open</button>'
  ])):'<div class="empty">Open an award and save its business fit or complete workshare.</div>';
}
function reviewValue(){
  const old=state.data.reviews.find(r=>r.award_key===state.award.award_key)?.data??{},oldUrls=new Map((old.businessFitUrls??[]).map(s=>[s.url,s]));
  return {status:$('r-status').value,fit:$('r-fit').value,workshare:$('r-workshare').value,deliverables:$('r-deliverables').value,acceptance:$('r-acceptance').value,constraints:$('r-constraints').value,feeUsd:$('r-fee').value,durationDays:$('r-days').value,primeContact:$('r-contact').value,owner:$('r-owner').value,caseUrl:$('r-case').value,notes:$('r-notes').value,nextAction:$('r-next').value,nextActionDate:$('r-next-date').value,businessFitUrls:listLines('r-urls').map(url=>({...oldUrls.get(url),url,title:oldUrls.get(url)?.title??'',observedAt:$('r-observed').value,notes:oldUrls.get(url)?.notes??''}))};
}
function renderMerchants(){
  const packages=state.data.publications.filter(p=>p.data.merchantId);
  $('merchant-packages').innerHTML=packages.map(p=>'<div class="record"><h3>'+esc(p.data.merchantId)+'</h3><p>'+p.data.rows+' awards · '+(p.data.configured?'Priced merchant configured':'Research dataset prepared')+'</p><p class="mono">'+esc(p.data.snapshot)+'</p><p>Open this retained package with the installed merchant-serve command.</p></div>').join('');
}
async function renderReceiving(){
  const r=await api('/api/receiving');$('receiving').innerHTML=!r.enabled?'<div class="empty">Open the operator with its original receiving folder to list deliveries here.</div>':r.deliveries.length?r.deliveries.map(d=>'<div class="record"><h3>'+esc(d.name)+'</h3><button data-adopt="'+esc(d.name)+'">Adopt retained delivery</button></div>').join(''):'<div class="empty">Finalized original delivery folders will appear here.</div>';
}
async function renderHistory(){const h=await api('/api/history');$('history').innerHTML=table(['Time','Operation','Operator','Subject'],h.map(r=>[esc(time(r.at)),esc(r.action.replaceAll('_',' ')),esc(r.operator),'<span class="mono">'+esc(r.subject)+'</span>']));}

document.addEventListener('click',guarded(async event=>{
  const b=event.target.closest('button');if(!b)return;
  if(b.dataset.view)return go(b.dataset.view);if(b.dataset.go)return go(b.dataset.go);
  if(b.dataset.edition)return chooseEdition(b.dataset.edition);
  if(b.dataset.editQuery){editQuery(state.data.queries.find(q=>q.id===b.dataset.editQuery));return;}
  if(b.dataset.captureQuery){const q=state.data.queries.find(q=>q.id===b.dataset.captureQuery);await api('/api/captures',{queryId:q.id,queryRevision:q.revision});await refresh();notice('Source capture started. Each accepted original page is retained as it arrives.');return;}
  if(b.dataset.resume){await api('/api/captures',{captureId:b.dataset.resume});return refresh();}
  if(b.dataset.pauseCapture){await api('/api/cancel-capture',{captureId:b.dataset.pauseCapture});return refresh();}
  if(b.dataset.cancelJob){await api('/api/cancel-job',{jobId:b.dataset.cancelJob});return refresh();}
  if(b.dataset.sourceCapture)return download('/api/source?capture='+encodeURIComponent(b.dataset.sourceCapture)+'&page=1','source.json');
  if(b.dataset.award)return openAward(b.dataset.award);
  if(b.dataset.reviewKey)return openAward(b.dataset.reviewKey,b.dataset.reviewEdition);
  if(b.dataset.filterUei){$('f-uei').value=b.dataset.filterUei;state.page=1;return loadAwards();}
  if(b.dataset.adopt){await api('/api/adopt-delivery',{name:b.dataset.adopt});await refresh();notice('Original delivery adoption started. Open the resulting edition after completion.');return;}
  if(b.classList.contains('remove-agency'))b.closest('.agency-row').remove();
}));
document.addEventListener('change',event=>{if(event.target.dataset.selectAward){const key=event.target.dataset.selectAward;event.target.checked?state.selected.add(key):state.selected.delete(key);$('award-status').textContent=state.total+' matching awards · '+state.selected.size+' selected';}});
document.addEventListener('submit',guarded(async event=>{
  if(event.target.dataset.capacity){event.preventDefault();const c=state.data.captures.find(c=>c.id===event.target.dataset.capacity);await api('/api/capacity',{captureId:c.id,maxRows:Number(event.target.querySelector('input').value),expectedUpdatedAt:c.updated_at});await refresh();}
}));
$('refresh').addEventListener('click',guarded(refresh));$('edition').addEventListener('change',guarded(()=>chooseEdition($('edition').value)));
$('new-query').addEventListener('click',()=>editQuery(null));$('add-agency').addEventListener('click',()=>agencyRow());
$('query-form').addEventListener('submit',guarded(async event=>{event.preventDefault();const q=await api('/api/queries',{queryId:$('q-id').value||undefined,expectedRevision:Number($('q-revision').value),definition:queryDefinition()});editQuery(q);await refresh();notice('Saved cohort revision '+q.revision+'. Capture a new source edition when ready.');}));
$('filter-form').addEventListener('submit',guarded(async event=>{event.preventDefault();state.page=1;await loadAwards();}));
$('clear-filters').addEventListener('click',guarded(async()=>{for(const id of ['f-search','f-uei','f-agency','f-naics','f-psc'])$(id).value='';state.page=1;await loadAwards();}));
$('previous-page').addEventListener('click',guarded(async()=>{if(state.page>1)state.page--;await loadAwards();}));$('next-page').addEventListener('click',guarded(async()=>{state.page++;await loadAwards();}));
$('enrich-selected').addEventListener('click',guarded(async()=>{if(!state.selected.size)throw new Error('Select the original awards to enrich.');await api('/api/enrich',{editionId:activeEdition(),keys:[...state.selected]});await refresh();notice('Selected original award details are being acquired. The source edition remains retained.');}));
$('create-selection').addEventListener('click',guarded(async()=>{if(!state.selected.size)throw new Error('Select at least one award.');const edition=await api('/api/select-edition',{editionId:activeEdition(),awardKeys:[...state.selected],name:chosen().name+' · '+state.selected.size+' selected awards'});await refresh();await chooseEdition(edition.id);}));
$('close-award').addEventListener('click',()=>$('award-dialog').close());
$('review-form').addEventListener('submit',guarded(async event=>{event.preventDefault();const saved=await api('/api/reviews',{editionId:activeEdition(),award_key:state.award.award_key,expectedRevision:Number($('r-revision').value),review:reviewValue()});$('r-revision').value=saved.revision;await refresh();$('review-source-state').textContent='Saved revision '+saved.revision+' against this source edition.';}));
$('download-brief').addEventListener('click',guarded(()=>download('/api/brief?edition='+encodeURIComponent(activeEdition())+'&key='+encodeURIComponent(state.award.award_key),'workshare.md')));
$('export-edition').addEventListener('click',guarded(()=>download('/api/edition-export?edition='+encodeURIComponent(activeEdition()),'edition.json')));
$('export-csv').addEventListener('click',guarded(()=>download('/api/edition-export?edition='+encodeURIComponent(activeEdition())+'&format=csv','awards.csv')));
$('compare-form').addEventListener('submit',guarded(async event=>{
  event.preventDefault();const r=await api('/api/compare?before='+encodeURIComponent($('compare-before').value)+'&after='+encodeURIComponent($('compare-after').value));
  $('comparison').innerHTML='<p>'+r.before+' original rows → '+r.after+' later rows · '+r.unchanged+' unchanged awards · '+r.changes.length+' changed or unmatched identities</p><p class="meta">'+(r.queryMatches?'The retained source filters match.':'The retained source views differ; inspect their original query scope alongside these changes.')+'</p>'+r.changes.map(c=>'<div class="comparison-item"><h3>'+esc(c.award_key)+' '+pill(c.kind)+'</h3>'+(c.fields.length?'<div class="table-wrap changed-table">'+table(['Field','Before','After'],c.fields.map(f=>[esc(f.field),esc(fmt(f.before)),esc(fmt(f.after))]))+'</div>':'<p>'+esc((c.after??c.before)?.recipient_name??'')+'</p>')+'</div>').join('');
}));
$('m-priced').addEventListener('change',()=>{$('payment-fields').hidden=!$('m-priced').checked;});
$('merchant-form').addEventListener('submit',guarded(async event=>{
  event.preventDefault();const options={};
  if($('m-priced').checked){options.origin=$('m-origin').value;options.path=$('m-path').value;options.payment={scheme:$('m-scheme').value,network:$('m-network').value,asset:$('m-asset').value,payTo:$('m-payto').value,amount:$('m-amount').value,maxTimeoutSeconds:Number($('m-timeout').value)};}
  await api('/api/merchant',{editionId:activeEdition(),options});await refresh();notice('The immutable merchant package is being prepared from the selected edition.');
}));
$('preview-form').addEventListener('submit',guarded(async event=>{
  event.preventDefault();const query={};for(const line of listLines('preview-query')){const i=line.indexOf('=');if(i<1)throw new Error('Use one key=value per line.');const k=line.slice(0,i).trim();if(Object.hasOwn(query,k))throw new Error('Repeated query parameter: '+k);query[k]=line.slice(i+1);}
  const r=await api('/api/merchant-preview',{merchantId:$('preview-package').value,query});$('preview-result').innerHTML='<p class="meta">Original dataset read · snapshot '+esc(r.snapshot)+'</p><pre>'+esc(JSON.stringify(r.result.body,null,2))+'</pre>';
}));
$('backup').addEventListener('click',guarded(()=>download('/api/backup','award-workspace.json')));
$('restore-form').addEventListener('submit',guarded(async event=>{event.preventDefault();const file=$('restore-file').files[0];if(file.size>128*1024*1024)throw new Error('Use the CLI to restore a workspace larger than 128 MiB.');await api('/api/restore',JSON.parse(await file.text()));await refresh();notice('The original retained workspace was restored.');}));
editQuery(null);
refresh().catch(error=>{notice(error.message);$('connection').textContent='Open the workspace launch link';});
setInterval(async()=>{if(state.polling||document.hidden||!state.data?.jobs.some(j=>j.status==='running'))return;state.polling=true;try{await refresh();}catch(error){notice(error.message);}finally{state.polling=false;}},2000);
