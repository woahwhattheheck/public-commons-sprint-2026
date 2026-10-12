'use strict';
const $=id=>document.getElementById(id),esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const tokenKey='award-research-token:'+location.origin,token=location.hash.slice(1)||sessionStorage.getItem(tokenKey)||'';
if(location.hash){sessionStorage.setItem(tokenKey,token);history.replaceState(null,'',location.pathname+location.search);}
const incoming=new URLSearchParams(location.search);
const state={workspace:null,capture:incoming.get('capture'),summary:null,page:1,rows:null,busy:false,reviewRevision:0,searchTimer:null};
const reviewFields=['status','fit','fundingChange','proposedWorkshare','deliverables','acceptance','owner','caseUrl','nextAction','notes'];
const human=value=>String(value??'').replaceAll('_',' '),time=value=>value?String(value).replace('T',' ').replace(/\.\d+(Z|\+00:00)$/,' UTC'):'—';
function money(value){if(value===null||value===undefined)return 'Unknown';const text=String(value),negative=text.startsWith('-'),[whole,fraction='']=(negative?text.slice(1):text).split('.');return(negative?'−$':'$')+whole.replace(/\B(?=(\d{3})+(?!\d))/g,',')+'.'+fraction.padEnd(2,'0');}
function notice(text){$('notice').textContent=text;$('notice').hidden=!text;if($('source-dialog').open){let line=$('source-dialog').querySelector('[role="alert"]');if(!line){line=document.createElement('p');line.setAttribute('role','alert');line.className='warning';$('source-dialog').prepend(line);}line.textContent=text;line.hidden=!text;}}
function guarded(fn){return async event=>{try{notice('');await fn(event);}catch(error){notice(error.message);}};}
async function api(path,body){const response=await fetch(path,{method:body===undefined?'GET':'POST',headers:{'x-research-token':token,...(body===undefined?{}:{'content-type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)})});const result=await response.json();if(!response.ok)throw new Error(result.message??result.error??'Request failed');return result;}
async function download(path,fallback){const response=await fetch(path,{headers:{'x-research-token':token}});if(!response.ok){const error=await response.json();throw new Error(error.message??error.error);}const url=URL.createObjectURL(await response.blob()),a=document.createElement('a');a.href=url;a.download=/filename="([^"]+)"/.exec(response.headers.get('content-disposition')??'')?.[1]??fallback;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);}
function table(headers,rows){return '<table><thead><tr>'+headers.map(([label,cls])=>'<th class="'+(cls??'')+'">'+esc(label)+'</th>').join('')+'</tr></thead><tbody>'+rows.map(cells=>'<tr>'+cells.map(([value,cls])=>'<td class="'+(cls??'')+'">'+value+'</td>').join('')+'</tr>').join('')+'</tbody></table>';}
const cell=value=>[esc(value)];
const amount=value=>[esc(money(value)),'money'];
function current(){if(!state.capture)throw new Error('Choose a transaction capture.');return state.capture;}
function query(extra={}){return new URLSearchParams({capture:current(),...extra}).toString();}
function captureLabel(c){return (c.recipient??c.award_key)+' · '+time(c.created_at)+' · '+human(c.status)+' · '+c.row_count+' actions';}
function options(id,captures,selected){$(id).innerHTML=captures.map(c=>'<option value="'+esc(c.id)+'">'+esc(captureLabel(c))+'</option>').join('');if(captures.some(c=>c.id===selected))$(id).value=selected;}
async function loadAwardOptions(){if(!$('edition').value){$('award-options').innerHTML='';return;}const q=new URLSearchParams({edition:$('edition').value,search:$('award-search').value,limit:'50',page:'1'});const result=await api('/api/rows?'+q);$('award-options').innerHTML=result.rows.map(r=>'<option value="'+esc(r.award_key)+'">'+esc((r.recipient_name??'')+' · '+(r.piid??''))+'</option>').join('');}
async function showAward(){if(!$('edition').value||!$('award').value){$('award-context').textContent='';return;}const row=await api('/api/award?'+new URLSearchParams({edition:$('edition').value,key:$('award').value}));$('award-context').textContent=(row.recipient_name??'')+' · '+(row.piid??'')+' · Retained obligations '+money(row.total_obligation_usd)+' · Observed '+time(row.source_observed_at);}
function renderCapture(){
  const s=state.summary,c=s?.capture,complete=c?.status==='complete';
  for(const id of ['csv','source-open','export','brief'])$(id).disabled=!c||(id==='source-open'&&c.page_count===0);
  $('review-fields').disabled=!complete;$('capacity-form').hidden=!c||complete||state.workspace.active.includes(c.id);
  $('capture-actions').innerHTML='';
  if(!c){$('capture-context').textContent='Choose an award or an existing capture.';return;}
  $('capture-context').innerHTML='<strong>'+esc(c.award_row.recipient_name??c.award_key)+'</strong><dl class="source-grid">'+[['Status',human(c.status)],['Capture',c.id],['Original pages',c.page_count],['Returned rows',c.row_count],['Next source page',complete?'Complete':c.next_page],['Award edition',c.award_edition_id]].map(([k,v])=>'<dt>'+esc(k)+'</dt><dd>'+esc(v)+'</dd>').join('')+'</dl>'+(c.error?'<div class="warning">'+esc(c.error.message)+(c.error.retryAt?' Resume after '+esc(time(c.error.retryAt))+'.':'')+'</div>':'');
  $('capacity').value=c.max_rows;
  if(!complete)$('capture-actions').innerHTML=state.workspace.active.includes(c.id)?'<button data-pause="'+esc(c.id)+'">Pause capture</button>':'<button data-resume="'+esc(c.id)+'" class="primary">Resume original capture</button>';
  $('source-page').max=Math.max(1,c.page_count);
}
function renderAnalysis(){
  const a=state.summary?.analysis;if(!a){$('metrics').innerHTML='';$('coverage').textContent='';$('quality').innerHTML='';$('fiscal-years').innerHTML='';return;}
  $('metrics').innerHTML=[['Unique actions',a.unique_transactions],['Captured net obligation',money(a.net_obligation_usd)],['Positive obligation',money(a.positive_obligation_usd)],['Deobligation',money(a.deobligation_usd)]].map(([k,v])=>'<div class="metric"><strong>'+esc(v)+'</strong><span>'+esc(k)+'</span></div>').join('');
  $('coverage').textContent=(a.coverage.complete?'Complete returned history':'Partial retained history')+' · '+a.occurrences+' source occurrences · '+a.first_action_date+' to '+a.last_action_date+' · Award obligations at its own observation '+money(a.award_obligation_usd)+' · Difference '+money(a.award_obligation_difference_usd);
  const warnings=[];
  if(a.duplicate_occurrences.length)warnings.push(a.duplicate_occurrences.length+' identical repeated source occurrences are represented once in financial totals.');
  if(a.conflicts.length)warnings.push(new Set(a.conflicts.map(x=>x.transaction_id)).size+' transaction identities have conflicting source records. Their source occurrences remain in the export; affected totals are unknown.');
  if(a.unknown_amounts)warnings.push(a.unknown_amounts+' unique transactions have no source obligation amount.');
  if(!a.coverage.complete)warnings.push('Resume this capture to acquire its remaining pages.');
  $('quality').innerHTML=warnings.map(v=>'<p class="warning">'+esc(v)+'</p>').join('');
  $('fiscal-years').innerHTML=a.by_fiscal_year.length?table([['Federal fiscal year'],['Actions'],['Net obligation','money'],['Known obligation','money'],['Source conflicts']],a.by_fiscal_year.map(y=>[cell(y.fiscal_year),cell(y.transactions===null?'Up to '+y.possible_transactions:y.transactions),amount(y.net_obligation_usd),amount(y.known_obligation_usd),cell(y.conflicted_transactions)])):'';
}
function renderReview(){
  const r=state.summary?.review;state.reviewRevision=r?.revision??0;
  for(const field of reviewFields)$('review-'+field).value=r?.data[field]??(field==='status'?'researching':'');
  $('review-revision').textContent=r?'Revision '+r.revision+' · '+r.operator+' · '+time(r.updated_at):'No saved assessment';
}
async function loadRows(){
  if(!state.capture){$('timeline').innerHTML='Choose a retained transaction capture.';$('page-state').textContent='';$('previous').disabled=$('next').disabled=true;return;}
  const result=await api('/api/transactions/rows?'+query({page:String(state.page),limit:'50',search:$('search').value,startDate:$('start-date').value,endDate:$('end-date').value}));state.rows=result;
  $('timeline').innerHTML=result.rows.length?table([['Action date / modification'],['Agency action'],['Obligation','money'],['Running obligation','money'],['Original description / identity'],['Source']],result.rows.map(r=>[
    [esc(r.action_date)+'<span class="meta">'+esc(r.modification_number??'No modification number')+'</span>'],
    [esc(r.action_type_description??'Not provided')+'<span class="meta">'+esc(r.source_conflict?'Conflicting records':r.federal_action_obligation===null?'Amount unavailable':r.federal_action_obligation==='0'?'Zero funding change':r.federal_action_obligation.startsWith('-')?'Deobligation':'Positive obligation')+'</span>'],
    amount(r.source_conflict?null:r.federal_action_obligation),amount(r.running_obligation_usd),
    [esc(r.description??'')+'<span class="meta mono">'+esc(r.transaction_id)+'</span>','wide'],
    ['<button data-source-page="'+r.source_page+'">Page '+r.source_page+'</button>']
  ])):'<p class="empty">No matching actions.</p>';
  $('page-state').textContent='Page '+result.page+' · '+result.rows.length+' of '+result.total;$('previous').disabled=state.page===1;$('next').disabled=!result.hasNext;
}
async function selectCapture(captureId,{resetReview=true,resetPage=true}={}){
  if(resetPage||state.capture!==captureId)state.page=1;state.capture=captureId||null;
  state.summary=state.capture?await api('/api/transactions/summary?'+query()):null;
  renderCapture();renderAnalysis();if(resetReview)renderReview();await loadRows();
  if(state.capture){sessionStorage.setItem('award-transactions-capture:'+state.workspace.id,state.capture);$('capture').value=state.capture;}
  const c=state.summary?.capture,matching=state.workspace.transactions.captures.filter(x=>!c||x.award_key===c.award_key);
  const oldBefore=$('before').value,oldAfter=$('after').value;
  options('before',matching,oldBefore||matching[1]?.id);options('after',matching,oldAfter||state.capture);
}
async function refresh({resetReview=false}={}){
  if(state.busy)return;state.busy=true;
  try{
    const previousRevision=state.summary?.review?.revision??0;state.workspace=await api('/api/state');const w=state.workspace;
    $('workspace-id').textContent=w.id;$('connection').textContent=w.active.length?w.active.length+' source operation(s) active':'Workspace connected';
    const previousEdition=$('edition').value||incoming.get('edition');$('edition').innerHTML=w.editions.map(e=>'<option value="'+esc(e.id)+'">'+esc(e.name+' · '+e.row_count+' awards')+'</option>').join('');if(w.editions.some(e=>e.id===previousEdition))$('edition').value=previousEdition;
    if(!$('award').value&&incoming.get('award'))$('award').value=incoming.get('award');
    const captures=w.transactions.captures,stored=sessionStorage.getItem('award-transactions-capture:'+w.id);
    if(!captures.some(c=>c.id===state.capture))state.capture=captures.find(c=>c.id===stored)?.id??captures.find(c=>c.award_key===$('award').value)?.id??captures[0]?.id??null;
    options('capture',captures,state.capture);
    $('jobs').innerHTML=w.jobs.filter(j=>j.type==='award_transactions').slice(-5).reverse().map(j=>'<div class="record"><span class="pill">'+esc(j.status)+'</span> '+esc(time(j.startedAt))+(j.error?'<p class="meta">'+esc(j.error.message)+'</p>':'')+(j.result?.captureId?'<button data-capture="'+esc(j.result.captureId)+'">Open capture</button>':'')+'</div>').join('');
    await selectCapture(state.capture,{resetReview,resetPage:false});
    if(!resetReview&&state.summary?.review&&state.summary.review.revision!==previousRevision)$('review-revision').textContent='A newer assessment is saved. Select this capture again to open revision '+state.summary.review.revision+'.';
    await loadAwardOptions();
  }finally{state.busy=false;}
}
async function readFile(id){const file=$(id).files[0];if(!file)throw new Error('Choose a JSON file.');if(file.size>128*1024*1024)throw new Error('The file exceeds the 128 MiB import size. Use full workspace recovery for larger backups.');return JSON.parse(await file.text());}
async function openSource(page){$('source-page').value=page;const result=await api('/api/transactions/source?'+query({page:String(page),format:'receipt'}));$('source-details').textContent=JSON.stringify(result,null,2);if(!$('source-dialog').open)$('source-dialog').showModal();}
$('refresh').addEventListener('click',guarded(()=>refresh()));
$('edition').addEventListener('change',guarded(async()=>{$('award').value='';$('award-context').textContent='';await loadAwardOptions();}));
$('award').addEventListener('change',guarded(showAward));
$('award-search').addEventListener('input',()=>{clearTimeout(state.searchTimer);state.searchTimer=setTimeout(()=>loadAwardOptions().catch(e=>notice(e.message)),250);});
$('capture').addEventListener('change',guarded(()=>selectCapture($('capture').value)));
$('capture-form').addEventListener('submit',guarded(async e=>{e.preventDefault();await api('/api/transactions/capture',{editionId:$('edition').value,awardKey:$('award').value,pageSize:Number($('page-size').value),maxRows:Number($('max-rows').value)});await refresh();notice('Transaction capture started. Each original page is retained as it arrives.');}));
$('capacity-form').addEventListener('submit',guarded(async e=>{e.preventDefault();await api('/api/transactions/capacity',{captureId:current(),maxRows:Number($('capacity').value),expectedUpdatedAt:state.summary.capture.updated_at});await refresh();}));
$('filter-form').addEventListener('submit',guarded(async e=>{e.preventDefault();state.page=1;await loadRows();}));
$('clear-filters').addEventListener('click',guarded(async()=>{for(const id of ['search','start-date','end-date'])$(id).value='';state.page=1;await loadRows();}));
$('previous').addEventListener('click',guarded(async()=>{state.page--;await loadRows();}));
$('next').addEventListener('click',guarded(async()=>{state.page++;await loadRows();}));
$('compare-form').addEventListener('submit',guarded(async e=>{
  e.preventDefault();const result=await api('/api/transactions/compare?'+new URLSearchParams({before:$('before').value,after:$('after').value}));
  const rows=[...result.added.map(r=>[cell('Added'),cell(r.transaction_id),cell(r.action_date+' · '+(r.description??'')),amount(r.federal_action_obligation)]),...result.changed.map(r=>[cell('Changed'),cell(r.transaction_id),[r.fields.map(f=>esc(f.field)+': '+esc(f.before??'Unknown')+' → '+esc(f.after??'Unknown')).join('<br>')],amount(r.obligation_delta_usd)]),...result.absent_in_later_capture.map(r=>[cell('Absent in later capture'),cell(r.transaction_id),cell(r.action_date),cell('—')]),...result.unresolved.map(r=>[cell('Source conflict'),cell(r.transaction_id),cell('Before conflict: '+r.before_source_conflict+' · After conflict: '+r.after_source_conflict),cell('Unknown')])];
  $('comparison').innerHTML='<p>Captured net change: <strong>'+esc(money(result.net_obligation_delta_usd))+'</strong> · Before '+esc(result.before_coverage.complete?'complete':'partial')+' · After '+esc(result.after_coverage.complete?'complete':'partial')+'</p>'+(rows.length?table([['Change'],['Original transaction identity'],['Source differences'],['Obligation change','money']],rows):'<p>No changed transactions in these retained observations.</p>')+'<p class="meta">An absent record describes the later observation. Source coverage and conflicting records remain visible in the comparison.</p>';
}));
$('review-form').addEventListener('submit',guarded(async e=>{e.preventDefault();const review=Object.fromEntries(reviewFields.map(f=>[f,$('review-'+f).value]));await api('/api/transactions/review',{captureId:current(),expectedRevision:state.reviewRevision,review});await refresh({resetReview:true});notice('Workshare assessment saved.');}));
$('csv').addEventListener('click',guarded(()=>download('/api/transactions/export?'+query({format:'csv'}),'transactions.csv')));
$('export').addEventListener('click',guarded(()=>download('/api/transactions/export?'+query({reviews:String($('include-reviews').checked)}),'transactions.json')));
$('brief').addEventListener('click',guarded(()=>download('/api/transactions/brief?'+query(),'transaction-workshare.md')));
$('receive-form').addEventListener('submit',guarded(async e=>{e.preventDefault();const packet=await readFile('receive-file'),result=await api('/api/transactions/receive',{packet,editionId:$('edition').value,includeReview:$('receive-reviews').checked});state.capture=result.captureId;await refresh({resetReview:true});notice('Capture received'+(result.reviewReceived?' with its private assessment.':'.'));}));
$('import-form').addEventListener('submit',guarded(async e=>{e.preventDefault();const input=await readFile('import-file'),result=await api('/api/transactions/import',{editionId:$('edition').value,awardKey:$('award').value,pages:input.pages,maxRows:Number($('max-rows').value)});state.capture=result.captureId;await refresh({resetReview:true});notice('Original transaction pages imported.');}));
$('source-open').addEventListener('click',guarded(()=>openSource(1)));
$('source-close').addEventListener('click',()=>$('source-dialog').close());
$('source-form').addEventListener('submit',guarded(e=>{e.preventDefault();return openSource(Number($('source-page').value));}));
$('source-download').addEventListener('click',guarded(()=>download('/api/transactions/source?'+query({page:$('source-page').value}),'transaction-source.json')));
document.addEventListener('click',guarded(async e=>{const button=e.target.closest('button');if(!button)return;if(button.dataset.capture)return selectCapture(button.dataset.capture);if(button.dataset.resume){await api('/api/transactions/resume',{captureId:button.dataset.resume});return refresh();}if(button.dataset.pause){await api('/api/cancel-capture',{captureId:button.dataset.pause});return refresh();}if(button.dataset.sourcePage)return openSource(Number(button.dataset.sourcePage));}));
refresh({resetReview:true}).then(showAward).catch(error=>notice(error.message));
setInterval(()=>{if(!document.hidden&&state.workspace?.jobs.some(j=>j.type==='award_transactions'&&j.status==='running'))refresh().catch(error=>notice(error.message));},3000);
