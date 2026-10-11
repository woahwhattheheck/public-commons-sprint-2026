// MIT. Bitwave operator workflow over the original merchant/accountant workspace.
// Source rows, returned comparisons and bookkeeping decisions are owned by its API.
const $=id=>document.getElementById(id);
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const exact=value=>value===null?'Not recorded':value===undefined?'Not recorded':typeof value==='object'?JSON.stringify(value,null,2):String(value);
const date=value=>value?new Date(value).toLocaleString():'Not recorded';
const short=value=>typeof value==='string'&&value.length>26?value.slice(0,12)+'…'+value.slice(-8):exact(value);
const encode=value=>encodeURIComponent(value);
const badge=value=>'<span class="badge">'+esc(exact(value))+'</span>';
const values=object=>'<dl class="record-values">'+Object.entries(object??{}).map(([key,value])=>'<dt>'+esc(key.replace(/([a-z])([A-Z])/g,'$1 $2'))+'</dt><dd>'+esc(exact(value))+'</dd>').join('')+'</dl>';
const metrics=items=>items.map(([label,value])=>'<div class="metric"><span>'+esc(label)+'</span><strong>'+esc(exact(value))+'</strong></div>').join('');
const newest=items=>[...(items??[])].sort((a,b)=>(Date.parse(b.createdAt)||0)-(Date.parse(a.createdAt)||0))[0];
const PAGE=50,MAX_CAPTURE=64*1024*1024;
const initialQuery=new URLSearchParams(location.search);
let metadata=null,revision=0,selected=initialQuery.get('plan')||'',detail=null,accountant=null;
let captureId=initialQuery.get('capture')||'',captureDetail=null,currentView='plan',historyLimit=24;
let busy=false,pending=null,pollTimer=null,refreshToken=0,detailToken=0,captureToken=0,sourceToken=0,rowToken=0;
let sourceChoice='',createId=crypto.randomUUID(),importId=crypto.randomUUID(),loadedFiles=[],fileLoading=false,fileToken=0;
let sourceRows={items:[],total:0,offset:0,limit:PAGE},sourceIndex=-1,comparisonRows={items:[],total:0,offset:0,limit:PAGE},comparisonIndex=-1;
let preview=null,previewToken=0,previewOffset=0,previewUrl='';
let watchedCapture=null;
const nativeIds=new Map();
const base=()=>'/api/bitwave/plans/'+encode(selected);
const captures=()=>detail?.captures??[];
const operations=()=>detail?.operations??[];
const running=()=>operations().find(op=>op.status==='RUNNING');
const parentId=()=>accountant?.record?.revisions?.at(-1)?.id??null;
const revisionsOf=handoff=>handoff?.revisions??[];

class RequestError extends Error{
  constructor(response,data){super(data.message||data.error||'The workspace request could not be completed.');this.status=response.status;this.code=data.error;}
}
async function api(path,body){
  const response=await fetch(path,body===undefined?{cache:'no-store'}:{method:'POST',headers:{'Content-Type':'application/json','X-Workspace-Request':'1'},body:JSON.stringify(body)});
  const result=await response.json().catch(()=>({message:'The workspace returned an unreadable response.'}));
  if(!response.ok)throw new RequestError(response,result);
  const saved=typeof result.revision==='number'?result.revision:result.state?.revision;
  if(typeof saved==='number')revision=Math.max(revision,saved);
  return result;
}
function notify(message,error=false){$('bitwave-message').textContent=message;$('bitwave-message').classList.toggle('error',error);$('bitwave-message').hidden=!message;}
function attempt(work){return Promise.resolve().then(work).catch(error=>notify(error.message||String(error),true));}
function operator(){const value=$('bitwave-operator').value.trim();if(!value){$('bitwave-operator').focus();throw new Error('Enter the operator or reviewer name before saving.');}return value;}
function options(element,items,wanted=element.value){
  const html=items.map(([id,label])=>'<option value="'+esc(id)+'">'+esc(label)+'</option>').join('');
  if(element.innerHTML!==html)element.innerHTML=html;
  element.value=items.some(([id])=>id===wanted)?wanted:items[0]?.[0]??'';
}
function rememberSelection(){
  const url=new URL(location.href);if(selected)url.searchParams.set('plan',selected);else url.searchParams.delete('plan');
  if(captureId)url.searchParams.set('capture',captureId);else url.searchParams.delete('capture');
  history.replaceState(null,'',url);document.title=(detail?.plan?.name?detail.plan.name+' · ':'')+'Bitwave reconciliation';
}
function showView(view){
  currentView=view;
  document.querySelectorAll('[data-bitwave-view]').forEach(button=>{const active=button.dataset.bitwaveView===view;button.classList.toggle('active',active);if(active)button.setAttribute('aria-current','page');else button.removeAttribute('aria-current');});
  document.querySelectorAll('.bitwave-view').forEach(section=>{section.hidden=section.id!=='bitwave-view-'+view;});
}
function controls(){
  const writable=Boolean(metadata)&&!busy&&!pending,active=Boolean(running());
  $('bitwave-create').disabled=!writable||!$('bitwave-handoff').value;
  $('bitwave-bind').disabled=!writable||!detail||active;
  $('bitwave-native-create').disabled=!writable||!detail||active||!metadata?.connection?.configured||Boolean(detail?.binding?.dataSourceId);
  if(detail?.record?.createUncertain)$('bitwave-native-create').disabled=true;
  $('bitwave-native-upload').disabled=!writable||!detail?.binding?.dataSourceId||active||!metadata?.connection?.configured;
  if(detail?.record?.batches?.some(b=>['SENDING','UNCERTAIN'].includes(b.status)))$('bitwave-native-upload').disabled=true;
  $('bitwave-native-capture').disabled=!writable||!detail?.binding?.dataSourceId||active||!metadata?.connection?.configured;
  $('bitwave-stop').disabled=busy||!active;
  $('bitwave-repair').disabled=!writable||active||!metadata?.connection?.configured;
  $('bitwave-resume-capture').disabled=!writable||active||!metadata?.connection?.configured;
  $('bitwave-import').disabled=!writable||!detail||fileLoading||!loadedFiles.length;
  $('bitwave-preview').disabled=!writable||!captureDetail||!detail;
  $('bitwave-apply').disabled=!writable||!preview?.value?.preview?.revision||preview.planId!==selected||preview.captureId!==captureId;
  $('bitwave-clear-preview').disabled=busy;
  $('bitwave-retry').disabled=busy||!pending;$('bitwave-dismiss-retry').disabled=busy;
  document.body.classList.toggle('working',busy);
}
function invalidatePreview(){
  preview=null;++previewToken;previewOffset=0;
  clearPreviewDownload();
  $('bitwave-preview-panel').hidden=true;$('bitwave-preview-empty').hidden=false;controls();
}
function clearPreviewDownload(){
  if(previewUrl){URL.revokeObjectURL(previewUrl);previewUrl='';}
  $('bitwave-preview-download').removeAttribute('href');$('bitwave-preview-download').hidden=true;
}
async function perform(intent,retrying=false){
  if(busy)return;
  if(pending&&!retrying){notify('Read or dismiss the submitted operation before starting another write. Your form is retained.',true);return;}
  busy=true;controls();
  try{
    const result=await api(intent.path,intent.body);pending=null;$('bitwave-retry-panel').hidden=true;
    if(intent.success)await intent.success(result);
    await refresh();notify(typeof intent.message==='function'?intent.message(result):intent.message||'Saved to the original workspace.');
  }catch(error){
    if(error.status===409){
      pending=null;$('bitwave-retry-panel').hidden=true;
      if(intent.path.endsWith('/returns'))invalidatePreview();
      await refresh().catch(()=>{});
      notify(error.message+' The current saved state is loaded; review the retained form or preview again before saving.',true);
    }else if(!error.status||error.status>=500){
      pending=intent;$('bitwave-retry-panel').hidden=false;
      $('bitwave-retry-message').textContent=(error.message||'The response could not be read.')+' The exact submitted identity and payload remain in this tab.';
      notify('The submitted '+intent.description+' needs a response. Use the retained same-operation retry.',true);
    }else{pending=null;$('bitwave-retry-panel').hidden=true;notify(error.message,true);}
  }finally{busy=false;controls();}
}
function renderSourceChoices(){
  const handoffs=metadata?.handoffs??[];
  const preferred=sourceChoice||initialQuery.get('handoff')||$('bitwave-handoff').value;
  options($('bitwave-handoff'),handoffs.length?handoffs.map(h=>[h.id,h.name+' · '+h.rowCount+' original events']):[['','Prepare an accountant handoff first']],preferred);
  selectHandoffSource(false);
}
function selectHandoffSource(changed=true){
  const id=$('bitwave-handoff').value,handoff=metadata?.handoffs.find(h=>h.id===id);
  const wasChanged=sourceChoice!==id;sourceChoice=id;
  const returns=revisionsOf(handoff),choices=[['','Original handoff'],...returns.slice().reverse().map(r=>[r.id,r.name+' · '+date(r.createdAt)])];
  const wanted=wasChanged?(initialQuery.get('handoff')===id&&initialQuery.has('revision')?initialQuery.get('revision'):returns.at(-1)?.id??''):$('bitwave-accountant-revision').value;
  options($('bitwave-accountant-revision'),choices,wanted);
  if(wasChanged){createId=crypto.randomUUID();if(handoff)$('bitwave-name').value=(handoff.name+' · Bitwave').slice(0,160);}
  const chosen=returns.find(r=>r.id===$('bitwave-accountant-revision').value);
  $('bitwave-source-description').innerHTML=handoff?'<p><strong>'+esc(handoff.name)+'</strong> · '+esc(handoff.rowCount)+' original events · '+esc(chosen?'Saved return: '+chosen.name:'Original handoff')+'</p><p class="hint">'+esc(handoff.source?.periodClose?'Period close '+handoff.source.periodClose.id+' · revision '+handoff.source.periodClose.revision:'Original reconciliation '+(handoff.source?.runId??''))+'</p>':'<p>Prepare a handoff in the original accountant workspace to select its rows here.</p>';
  if(changed)createId=crypto.randomUUID();controls();
}
function renderHistory(){
  const search=$('bitwave-plan-search').value.trim().toLowerCase();
  const plans=(metadata?.plans??[]).filter(p=>!search||[p.name,p.id,p.orgId,p.handoffId,p.actor].some(v=>String(v??'').toLowerCase().includes(search)));
  $('bitwave-plan-list').innerHTML=plans.slice(0,historyLimit).map(p=>'<button type="button" data-bitwave-plan="'+esc(p.id)+'"'+(p.id===selected?' class="selected" aria-current="true"':'')+'><strong>'+esc(p.name)+'</strong><span>'+esc(date(p.createdAt))+'</span><span>'+esc(p.rowCount??'')+' source rows · '+esc(p.orgId??'')+'</span></button>').join('')||'<p class="hint">No retained plans match this search.</p>';
  $('bitwave-plan-more').hidden=plans.length<=historyLimit;
  $('bitwave-state-version').textContent='Saved workspace revision '+revision+' · '+(metadata?.plans.length??0)+' retained plans';
}
const download=(filename,label,planId=selected)=>'<a class="button" download href="/api/bitwave/plans/'+encode(planId)+'/download/'+encode(filename)+'">'+esc(label||filename)+'</a>';
function renderPlan(){
  $('bitwave-selected').hidden=!detail;$('bitwave-empty').hidden=Boolean(detail);
  if(!detail){controls();return;}
  const p=detail.plan,binding=detail.binding,active=running(),connection=metadata?.connection??{};
  $('bitwave-title').textContent=p.name;$('bitwave-subtitle').textContent='Prepared by '+p.actor+' · '+date(p.createdAt)+' · '+p.rowCount+' original rows';
  $('bitwave-binding-badge').textContent=binding?.dataSourceId?'Data source bound':'Native plan retained';
  $('bitwave-org-label').textContent='Organization '+p.orgId;
  $('bitwave-current-source').textContent='Accountant handoff '+p.handoffId+' · '+(p.accountantRevisionId?'Saved return '+p.accountantRevisionId:'Original handoff')+(binding?.dataSourceId?' · Data source '+binding.dataSourceId:'');
  $('bitwave-metrics').innerHTML=metrics([['Original rows',p.rowCount],['Native batches',p.batches.length],['Received sets',captures().length],['Retained operations',operations().length]]);
  $('bitwave-lineage').innerHTML=values({planId:p.id,handoffId:p.handoffId,accountantRevisionId:p.accountantRevisionId,orgId:p.orgId,dataSourceId:binding?.dataSourceId??null,...p.source,planSha256:p.integrity?.sha256}).replace(/^<dl class="record-values">|<\/dl>$/g,'');
  $('bitwave-connection').innerHTML='<strong>'+esc(connection.configured?'Native API connection configured':'Use the retained requests or configure the native API connection')+'</strong><p>'+esc(connection.configured?'Native actions run through the original workspace server for the selected organization.':'The complete request files and received-page import remain available. The server reads the configured Bitwave token from its environment.')+'</p><p class="hint">'+esc(connection.baseUrl??'')+(connection.tokenEnv?' · server environment '+esc(connection.tokenEnv):'')+'</p>';
  $('bitwave-operation-progress').hidden=!active;
  const latest=operations().at(-1);
  $('bitwave-operation-status').textContent=active?(active.message||'The native operation is running; its progress and responses are retained.'):(latest?[latest.action,latest.status,latest.message].filter(Boolean).join(' · '):'Create or bind the native data source, then upload and capture this plan.');
  $('bitwave-operation-progress-label').textContent=active?active.action+' · '+(active.completedBatches??0)+' / '+(active.totalBatches??p.batches.length)+' requests complete':'';
  const progress=$('bitwave-operation-progress').querySelector('progress');if(active?.totalBatches){progress.max=active.totalBatches;progress.value=active.completedBatches??0;}else progress.removeAttribute('value');
  if(!$('bitwave-data-source').dataset.dirty)$('bitwave-data-source').value=binding?.dataSourceId??'';
  $('bitwave-downloads').innerHTML=[download('create-data-source.json','Create data-source request'),download('expected-rows.json','Frozen expected rows'),download('accountant.csv','Original accountant CSV'),download('bitwave-handoff.tar','Complete Bitwave handoff'),'<button type="button" data-bitwave-request="create-data-source.json">Inspect create request</button>'].join('');
  $('bitwave-batches').innerHTML=p.batches.map(b=>{const saved=detail.record?.batches?.find(item=>item.index===b.index);return '<tr><td>'+esc(b.index)+'</td><td>'+esc(b.rowCount)+'</td><td>'+esc(b.sha256)+'</td><td>'+badge(saved?.status??'PENDING')+'</td><td><div class="actions">'+download(b.file,'Download')+'<button type="button" data-bitwave-request="'+esc(b.file)+'">Inspect</button></div></td></tr>';}).join('');
  $('bitwave-schema').innerHTML='<table><thead><tr><th>Original field</th><th>Native type</th><th>Role</th></tr></thead><tbody>'+p.schemaColumns.map(c=>'<tr><td>'+esc(c.name)+'</td><td>'+esc(c.type)+'</td><td>'+esc(c.name===p.idFieldName?'Frozen export primary key':c.name==='rowId'?'Original accountant join':['externalStatus','externalBookRef','externalAccountCode','externalNote'].includes(c.name)?'Returned bookkeeping':'Retained source identity/value')+'</td></tr>').join('')+'</tbody></table>';
  $('bitwave-docs').innerHTML=(metadata.docs??p.docs??[]).filter(d=>/^https:\/\//i.test(d.url)).map(d=>'<a class="button" href="'+esc(d.url)+'" target="_blank" rel="noreferrer">'+esc(d.title)+'</a>').join('');
  renderCaptureChoices();renderOperations();renderAccountant();controls();rememberSelection();
}
function renderOperations(){
  $('bitwave-operations').innerHTML=operations().slice().reverse().map(op=>'<tr><td><strong>'+esc(op.action)+'</strong><span class="subtle mono">'+esc(op.id)+'</span></td><td>'+badge(op.status)+'</td><td>'+esc(op.completedBatches??0)+' / '+esc(op.totalBatches??'—')+'</td><td>'+esc(date(op.startedAt))+'<span class="subtle">'+esc(op.finishedAt?date(op.finishedAt):'')+'</span></td><td>'+esc(op.message??'')+'</td></tr>').join('')||'<tr><td colspan="5" class="empty">Native operations will appear here as they are requested.</td></tr>';
  const files=(detail?.files??[]).map(f=>typeof f==='string'?{name:f}:f).map(f=>({name:f.name??f.file??f.path,bytes:f.bytes??f.size})).filter(f=>f.name);
  $('bitwave-files').innerHTML=files.length?'<div class="bitwave-file-list">'+files.map(f=>download(f.name,f.name+(f.bytes!==undefined?' · '+f.bytes+' bytes':''))).join('')+'</div>':'<p class="hint">The native create request, row batches and complete handoff are available under Native plan & requests.</p>';
  $('bitwave-capture-history').innerHTML=captures().slice().reverse().map(c=>'<tr><td>'+esc(c.name)+'<span class="subtle mono">'+esc(c.id)+'</span></td><td>'+badge(c.status)+'</td><td>'+esc(date(c.createdAt))+'</td><td><button type="button" data-bitwave-capture="'+esc(c.id)+'">Open received set</button></td></tr>').join('')||'<tr><td colspan="4" class="empty">Received native pages remain listed here after capture or import.</td></tr>';
}
function renderCaptureChoices(){
  const saved=captures(),choices=saved.length?saved.slice().reverse().map(c=>[c.id,c.name+' · '+c.status+' · '+date(c.createdAt)]):[['','No received rows yet']];
  options($('bitwave-capture-select'),choices,captureId);
  const c=saved.find(c=>c.id===captureId);
  $('bitwave-capture-description').textContent=c?c.name+' · '+date(c.createdAt)+' · '+(c.files?.length??c.summary?.pages??0)+' retained files':'Capture native rows or import their original JSON page files.';
}
async function refresh(){
  const token=++refreshToken,result=await api('/api/bitwave');if(token!==refreshToken)return;
  metadata=result;revision=Math.max(revision,result.revision??0);renderSourceChoices();renderHistory();
  if(!metadata.plans.some(p=>p.id===selected))selected=metadata.plans[0]?.id??'';
  await selectPlan(selected,{reset:false});
}
async function selectPlan(id,{reset=true}={}){
  clearTimeout(pollTimer);
  const changed=selected!==id;selected=id;
  if(changed){detail=null;accountant=null;captureId='';captureDetail=null;sourceIndex=-1;comparisonIndex=-1;loadedFiles=[];++fileToken;fileLoading=false;$('bitwave-capture-files').value='';$('bitwave-file-status').textContent='Choose the complete set of received page files.';$('bitwave-capture-name').value='';$('bitwave-return-name').value='';delete $('bitwave-data-source').dataset.dirty;invalidatePreview();showView('plan');}
  renderHistory();if(!id){detail=null;renderPlan();return;}
  const token=++detailToken;
  const result=await api(base());if(token!==detailToken||selected!==id)return;detail=result;
  if(watchedCapture?.planId===id){const op=operations().find(o=>o.id===watchedCapture.operationId);if(op&&op.status!=='RUNNING'){if(op.captureId){captureId=op.captureId;captureDetail=null;invalidatePreview();showView('captures');}watchedCapture=null;}}
  const original=await api('/api/accountant/handoffs/'+encode(result.plan.handoffId));if(token!==detailToken||selected!==id)return;accountant=original;
  if(preview&&preview.request.expectedParentId!==parentId()){invalidatePreview();notify('The original accountant return changed. Preview this retained received set against the current return before saving.',true);}
  if(!captures().some(c=>c.id===captureId))captureId=newest(captures())?.id??'';
  renderPlan();renderHistory();await Promise.all([loadSourceRows(reset?0:sourceRows.offset),selectCapture(captureId,{reset:reset||changed})]);
  if(running()&&!document.hidden)pollTimer=setTimeout(()=>attempt(()=>selectPlan(selected,{reset:false})),2000);
}
function renderSourceRows(){
  $('bitwave-source-rows').innerHTML=sourceRows.items.map((row,index)=>'<tr'+(index===sourceIndex?' class="selected"':'')+'><td><button type="button" class="inspect" data-bitwave-source-index="'+index+'">'+esc(row.method+' '+row.routeId)+'</button><span class="subtle">'+esc(row.network)+'</span><span class="subtle mono">'+esc(short(row.rowId))+'</span></td><td class="exact">'+esc(row.amountAtomic)+'<span class="subtle">'+esc(row.unitLabel||'atomic units')+'</span></td><td>'+esc(row.externalStatus)+'</td><td>'+esc(row.externalBookRef||'—')+'</td></tr>').join('')||'<tr><td colspan="4" class="empty">No source rows match this filter.</td></tr>';
  pageLabel('bitwave-source',sourceRows);
  $('bitwave-source-detail').innerHTML=sourceRows.items[sourceIndex]?'<h3>Exact frozen source row</h3>'+values(sourceRows.items[sourceIndex]):'<p class="hint">Select a row to inspect all source fields and native identity.</p>';
}
function pageLabel(prefix,data){
  $(prefix+'-page').textContent=data.total?(data.offset+1)+'–'+Math.min(data.offset+data.items.length,data.total)+' of '+data.total+' rows':'0 rows';
  $(prefix+'-previous').disabled=data.offset===0;$(prefix+'-next').disabled=data.offset+data.items.length>=data.total;
}
async function loadSourceRows(offset=0){
  if(!detail)return;const token=++sourceToken,id=selected;
  const result=await api(base()+'/rows?'+new URLSearchParams({offset:String(offset),limit:String(PAGE),search:$('bitwave-source-search').value}));
  if(token!==sourceToken||id!==selected)return;
  if(result.total&&offset>=result.total)return loadSourceRows(Math.floor((result.total-1)/PAGE)*PAGE);
  sourceRows=result;if(sourceIndex>=result.items.length)sourceIndex=-1;renderSourceRows();
}
async function selectCapture(id,{reset=true}={}){
  const changed=captureId!==id;captureId=id;
  if(changed){captureDetail=null;comparisonIndex=-1;invalidatePreview();}
  renderCaptureChoices();rememberSelection();
  if(!id){captureDetail=null;$('bitwave-comparison').hidden=true;controls();return;}
  const token=++captureToken,plan=selected;
  const result=await api(base()+'/captures/'+encode(id));if(token!==captureToken||id!==captureId||plan!==selected)return;
  captureDetail=result;renderComparison();await loadComparisonRows(reset?0:comparisonRows.offset);
}
function renderComparison(){
  $('bitwave-comparison').hidden=!captureDetail;if(!captureDetail)return;
  const comparison=captureDetail.comparison,c=captureDetail.capture,s=comparison.summary;
  $('bitwave-capture-status').textContent='Received set '+(c.status??comparison.status);
  $('bitwave-comparison-metrics').innerHTML=metrics([['Expected rows',s.expectedRows],['Received rows',s.receivedRows],['Source matched',s.matchedRows],['Changed source',s.changedRows],['Missing',s.missingRows],['Other / unknown',s.unknownRows],['Duplicate',s.duplicateRows]]);
  $('bitwave-comparison-message').textContent='Matching uses this plan’s native export identity and exact original source strings. '+s.matchedRows+' source-matched rows are available to the accountant matcher; '+s.changedRows+' changed, '+s.missingRows+' missing and '+s.duplicateRows+' duplicate source rows remain visible in this comparison.';
  const issues=[...(comparison.issues??[]),...(c.issues??[])];
  $('bitwave-capture-issues-panel').hidden=!issues.length;$('bitwave-capture-issues').textContent=JSON.stringify(issues,null,2);
  const native=c.source?.kind==='native-api'&&c.source.orgId===detail.plan.orgId&&c.source.dataSourceId===detail.binding?.dataSourceId;
  const lastWrite=Math.max(0,...operations().filter(o=>['create','upload','repair'].includes(o.action)).map(o=>Date.parse(o.finishedAt??o.startedAt)||0));
  const repair=native&&c.status==='COMPLETE'&&s.missingRows>0&&s.changedRows===0&&s.duplicateRows===0&&Date.parse(c.createdAt)>=lastWrite;
  const resume=native&&c.status==='PARTIAL'&&issues.some(issue=>issue.code==='MORE_PAGES');
  $('bitwave-repair').hidden=!repair;$('bitwave-resume-capture').hidden=!resume;
  $('bitwave-native-recovery').hidden=!repair&&!resume;
  if(!$('bitwave-return-name').value.trim())$('bitwave-return-name').value=(c.name+' · accountant return').slice(0,160);
  controls();
}
function renderComparisonRows(){
  $('bitwave-comparison-rows').innerHTML=comparisonRows.items.map((row,index)=>'<tr'+(index===comparisonIndex?' class="selected"':'')+'><td><button type="button" class="inspect" data-bitwave-compare-index="'+index+'">'+esc(short(row.rowId))+'</button><span class="subtle">'+esc(row.expected?.network??(Array.isArray(row.received)?'':row.received?.network)??'')+'</span></td><td>'+badge(row.status)+'</td><td>'+esc(row.changes?.map(c=>c.field).join(', ')||((row.occurrences??0)>1?row.occurrences+' received copies':'—'))+'</td><td>'+esc(Array.isArray(row.received)?'Multiple received rows':row.received?.externalStatus??'—')+'<span class="subtle">'+esc(Array.isArray(row.received)?'':row.received?.externalBookRef??'')+'</span></td></tr>').join('')||'<tr><td colspan="4" class="empty">No rows match these filters.</td></tr>';
  pageLabel('bitwave-comparison',comparisonRows);
  const row=comparisonRows.items[comparisonIndex];
  if(!row){$('bitwave-row-detail').innerHTML='<p class="hint">Select a result to inspect its exact original and received values.</p>';return;}
  let content='<h3>'+esc(row.status)+' · '+esc(short(row.rowId))+'</h3>';
  if(row.changes?.length)content+='<table class="bitwave-changes"><thead><tr><th>Field</th><th>Original</th><th>Received</th></tr></thead><tbody>'+row.changes.map(c=>'<tr><td>'+esc(c.field)+'</td><td>'+esc(exact(c.expected))+'</td><td>'+esc(exact(c.received))+'</td></tr>').join('')+'</tbody></table>';
  content+='<h3>Frozen source</h3>'+(row.expected?values(row.expected):'<p class="hint">This received row belongs outside the selected frozen source.</p>');
  content+='<h3>Received values</h3>'+(Array.isArray(row.received)?row.received.map((r,i)=>'<details><summary>Received copy '+(i+1)+'</summary>'+values(r)+'</details>').join(''):row.received?values(row.received):'<p class="hint">This source row is absent from the received pages.</p>');
  $('bitwave-row-detail').innerHTML=content;
}
async function loadComparisonRows(offset=0){
  if(!captureId||!captureDetail)return;const token=++rowToken,id=selected,capture=captureId;
  const result=await api(base()+'/captures/'+encode(capture)+'/rows?'+new URLSearchParams({offset:String(offset),limit:String(PAGE),search:$('bitwave-row-search').value,status:$('bitwave-row-status').value}));
  if(token!==rowToken||id!==selected||capture!==captureId)return;
  if(result.total&&offset>=result.total)return loadComparisonRows(Math.floor((result.total-1)/PAGE)*PAGE);
  comparisonRows=result;if(comparisonIndex>=result.items.length)comparisonIndex=-1;renderComparisonRows();
}
function renderAccountant(){
  if(!accountant||!detail)return;
  const h=accountant.record,current=accountant.selectedRevision??revisionsOf(h).at(-1),s=current?.summary??{};
  $('bitwave-accountant-current-description').textContent=h.name+' · '+(current?'Current return: '+current.name+' · '+current.id:'Original handoff awaiting its first return');
  $('bitwave-accountant-current-metrics').innerHTML=metrics([['Original events',h.rowCount],['Reviewed',s.reviewedRows??0],['Bookkeeper posted',s.bookedRows??0],['Excluded',s.excludedRows??0],['Saved returns',revisionsOf(h).length]]);
  const path='/api/accountant/handoffs/'+encode(h.id)+'/download/';
  $('bitwave-accountant-current-downloads').innerHTML='<a class="button" download href="'+path+'accountant.csv">Current accountant CSV</a><a class="button" download href="'+path+'review.html">Current offline review</a><a class="button" download href="'+path+'accountant-handoff.tar">Complete original handoff</a><a class="button" href="/">Merchant workspace</a>';
  $('bitwave-accountant-return-history').innerHTML=revisionsOf(h).slice().reverse().map(r=>'<tr><td>'+esc(r.name)+'<span class="subtle mono">'+esc(r.id)+'</span></td><td>'+esc(r.actor)+'</td><td>'+esc(date(r.createdAt))+'</td><td>'+esc(r.summary?.reviewedRows??0)+' / '+esc(r.summary?.bookedRows??0)+'</td><td><a class="button" download href="'+path+'accountant.csv?revisionId='+encode(r.id)+'">Saved CSV</a></td></tr>').join('')||'<tr><td colspan="5" class="empty">Saved original accountant returns will appear here.</td></tr>';
}
function renderPreview(){
  $('bitwave-preview-panel').hidden=!preview;$('bitwave-preview-empty').hidden=Boolean(preview);if(!preview)return;
  const r=preview.value.preview?.revision,s=r?.summary??{},results=r?.results??[];
  $('bitwave-preview-description').textContent=preview.request.name+' · current parent '+(preview.request.expectedParentId??'original handoff')+' · received set '+preview.captureId;
  $('bitwave-preview-metrics').innerHTML=r?metrics([['Matched changes',s.appliedRows],['Unchanged',s.unchangedRows],['Conflicts',s.conflictRows],['Unknown rows',s.unknownRows],['Missing from return',s.missingRows]]):metrics([['Source matched',preview.value.comparison?.summary?.matchedRows??0],['Changed source',preview.value.comparison?.summary?.changedRows??0],['Missing source',preview.value.comparison?.summary?.missingRows??0],['Bookkeeping conflicts',preview.value.editConflicts?.length??0],['Ready to save',0]]);
  const conflicts=preview.value.editConflicts??[];
  $('bitwave-edit-conflicts').hidden=!conflicts.length;
  $('bitwave-edit-conflicts').innerHTML=conflicts.length?'<h3>Bookkeeping edits to reconcile</h3><p class="hint">The current local return and received fields changed differently from the exported version. These rows retain their current assignments until their conflicting fields are reconciled and previewed again.</p>'+conflicts.map(c=>'<h4>'+esc(c.rowId)+'</h4><p class="hint">'+esc(c.message??c.code??'')+'</p><table class="bitwave-changes"><thead><tr><th>Field</th><th>Exported</th><th>Current local</th><th>Received</th></tr></thead><tbody>'+(c.fields??[]).map(f=>'<tr><td>'+esc(f.field)+'</td><td>'+esc(exact(f.exported))+'</td><td>'+esc(exact(f.current))+'</td><td>'+esc(exact(f.received))+'</td></tr>').join('')+'</tbody></table>').join(''):'';
  previewOffset=Math.min(previewOffset,Math.max(0,Math.floor((results.length-1)/PAGE)*PAGE));
  $('bitwave-preview-rows').innerHTML=results.slice(previewOffset,previewOffset+PAGE).map(row=>'<tr><td>'+esc(row.rowNumber)+'</td><td class="mono">'+esc(short(row.eventId))+'</td><td>'+badge(row.status)+'</td><td>'+esc(row.issues?.length?JSON.stringify(row.issues):'Original source fields match')+'</td></tr>').join('')||'<tr><td colspan="4" class="empty">This preview contains no source-matched returned rows.</td></tr>';
  $('bitwave-preview-page').textContent=results.length?(previewOffset+1)+'–'+Math.min(previewOffset+PAGE,results.length)+' of '+results.length+' returned rows':'0 returned rows';
  $('bitwave-preview-previous').disabled=previewOffset===0;$('bitwave-preview-next').disabled=previewOffset+PAGE>=results.length;
  controls();if(!r)$('bitwave-apply').disabled=true;
}
async function loadFiles(){
  const files=[...$('bitwave-capture-files').files],token=++fileToken;loadedFiles=[];fileLoading=false;importId=crypto.randomUUID();controls();
  if(!files.length){$('bitwave-file-status').textContent='Choose the complete set of received page files.';return;}
  const total=files.reduce((n,f)=>n+f.size,0);
  if(files.length>500||files.some(f=>!f.size)||total>MAX_CAPTURE)throw new Error('Choose 1–500 nonempty original JSON pages totaling at most 64 MiB.');
  fileLoading=true;controls();$('bitwave-file-status').textContent='Loading '+files.length+' original page files…';
  const loaded=[];
  try{
    for(const file of files){
      const data=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(new Error('Could not read '+file.name));reader.readAsDataURL(file);});
      if(token!==fileToken)return;loaded.push({name:file.name,dataBase64:String(data).split(',')[1]});
    }
    if(token!==fileToken)return;loadedFiles=loaded;
    if(!$('bitwave-capture-name').value.trim())$('bitwave-capture-name').value=files[0].name.replace(/\.json$/i,'').slice(0,160);
    $('bitwave-file-status').textContent=files.length+' original page files · '+total.toLocaleString()+' bytes · order: '+files.map(f=>f.name).join(', ');
  }finally{if(token===fileToken){fileLoading=false;controls();}}
}
async function nativeAction(action,extra={}){
  if(!detail)throw new Error('Choose a retained plan.');
  const key=selected+':'+action+':'+JSON.stringify(extra),id=nativeIds.get(key)??crypto.randomUUID(),planId=selected;nativeIds.set(key,id);
  await perform({path:base()+'/operations',body:{revision,id,actor:operator(),action,...extra},description:'native '+action,message:'Native '+action+' operation retained. Its current request and progress are visible in the plan.',success:result=>{nativeIds.delete(key);if(action==='capture')watchedCapture={planId,operationId:result.operation?.id??id};}});
}

$('bitwave-operator').value=(()=>{try{return localStorage.getItem('merchant-accounting.operator')||'';}catch{return '';}})();
$('bitwave-operator').addEventListener('input',()=>{invalidatePreview();createId=crypto.randomUUID();importId=crypto.randomUUID();try{localStorage.setItem('merchant-accounting.operator',$('bitwave-operator').value);}catch{}});
$('bitwave-refresh').addEventListener('click',()=>attempt(async()=>{await refresh();notify('Loaded the current plans, received sets and original accountant returns. Form drafts remain available.');}));
$('bitwave-plan-search').addEventListener('input',()=>{historyLimit=24;renderHistory();});
$('bitwave-plan-more').addEventListener('click',()=>{historyLimit+=24;renderHistory();});
$('bitwave-plan-list').addEventListener('click',event=>{const button=event.target.closest('[data-bitwave-plan]');if(button)attempt(()=>selectPlan(button.dataset.bitwavePlan));});
$('bitwave-handoff').addEventListener('change',()=>selectHandoffSource());
$('bitwave-accountant-revision').addEventListener('change',()=>selectHandoffSource());
$('bitwave-create-form').addEventListener('input',()=>{createId=crypto.randomUUID();});
$('bitwave-create-form').addEventListener('submit',event=>{event.preventDefault();attempt(async()=>{
  const body={revision,id:createId,handoffId:$('bitwave-handoff').value,accountantRevisionId:$('bitwave-accountant-revision').value||null,name:$('bitwave-name').value.trim(),actor:operator(),orgId:$('bitwave-org').value.trim(),description:$('bitwave-description').value,batchSize:Number($('bitwave-batch-size').value)};
  await perform({path:'/api/bitwave/plans',body,description:'Bitwave plan',message:'The selected original handoff and native request plan are retained.',success:async result=>{createId=crypto.randomUUID();await selectPlan(result.record?.id??result.plan?.id??body.id);showView('plan');}});
});});
document.querySelectorAll('[data-bitwave-view]').forEach(button=>button.addEventListener('click',()=>showView(button.dataset.bitwaveView)));
document.querySelectorAll('[data-bitwave-open]').forEach(button=>button.addEventListener('click',()=>showView(button.dataset.bitwaveOpen)));
$('bitwave-native-create').addEventListener('click',()=>attempt(()=>nativeAction('create')));
$('bitwave-native-upload').addEventListener('click',()=>attempt(()=>nativeAction('upload')));
$('bitwave-native-capture').addEventListener('click',()=>attempt(()=>nativeAction('capture')));
$('bitwave-resume-capture').addEventListener('click',()=>attempt(()=>nativeAction('capture',{resumeCaptureId:captureId})));
$('bitwave-repair').addEventListener('click',()=>attempt(()=>nativeAction('repair',{captureId,comparisonSha256:captureDetail.capture.integrity.sha256})));
$('bitwave-stop').addEventListener('click',()=>attempt(async()=>{const op=running();if(!op)return;await perform({path:base()+'/operations/'+encode(op.id)+'/stop',body:{actor:operator()},description:'operation stop',message:'Stop requested. The current request and its response are retained before the operation pauses.'});}));
$('bitwave-data-source').addEventListener('input',()=>{$('bitwave-data-source').dataset.dirty='true';});
$('bitwave-bind-form').addEventListener('submit',event=>{event.preventDefault();attempt(async()=>{await perform({path:base()+'/bind',body:{revision,actor:operator(),dataSourceId:$('bitwave-data-source').value.trim(),note:$('bitwave-bind-note').value.trim()},description:'native data-source binding',message:'The exact native data-source binding is retained with this plan.',success:()=>{delete $('bitwave-data-source').dataset.dirty;}});});});
document.addEventListener('click',event=>{const button=event.target.closest('[data-bitwave-request]');if(!button)return;attempt(async()=>{
  const id=selected,name=button.dataset.bitwaveRequest,response=await fetch(base()+'/download/'+encode(name),{cache:'no-store'});
  if(!response.ok)throw new Error('The retained request could not be read.');const text=await response.text();if(id!==selected)return;
  $('bitwave-request-name').textContent=name;$('bitwave-request-content').textContent=text;$('bitwave-request-panel').hidden=false;
});});
$('bitwave-source-filter').addEventListener('submit',event=>{event.preventDefault();sourceIndex=-1;attempt(()=>loadSourceRows(0));});
$('bitwave-source-previous').addEventListener('click',()=>{sourceIndex=-1;attempt(()=>loadSourceRows(Math.max(0,sourceRows.offset-PAGE)));});
$('bitwave-source-next').addEventListener('click',()=>{sourceIndex=-1;attempt(()=>loadSourceRows(sourceRows.offset+PAGE));});
$('bitwave-source-rows').addEventListener('click',event=>{const button=event.target.closest('[data-bitwave-source-index]');if(!button)return;sourceIndex=Number(button.dataset.bitwaveSourceIndex);renderSourceRows();$('bitwave-source-detail').focus({preventScroll:true});});
$('bitwave-capture-files').addEventListener('change',()=>attempt(loadFiles));
$('bitwave-capture-name').addEventListener('input',()=>{importId=crypto.randomUUID();});
$('bitwave-import-form').addEventListener('submit',event=>{event.preventDefault();attempt(async()=>{
  if(!loadedFiles.length||fileLoading)throw new Error('Choose and finish loading the original received page files.');
  const body={revision,id:importId,actor:operator(),name:$('bitwave-capture-name').value.trim(),files:loadedFiles};
  await perform({path:base()+'/imports',body,description:'received Bitwave pages',message:'The original received pages and source comparison are retained.',success:result=>{captureId=result.capture?.id??body.id;captureDetail=null;invalidatePreview();importId=crypto.randomUUID();loadedFiles=[];++fileToken;$('bitwave-capture-files').value='';$('bitwave-file-status').textContent='Received files saved. Choose a corrected or later page set to continue.';showView('captures');}});
});});
$('bitwave-capture-select').addEventListener('change',()=>attempt(()=>selectCapture($('bitwave-capture-select').value)));
$('bitwave-capture-history').addEventListener('click',event=>{const button=event.target.closest('[data-bitwave-capture]');if(button)attempt(async()=>{await selectCapture(button.dataset.bitwaveCapture);showView('captures');});});
$('bitwave-row-filter').addEventListener('submit',event=>{event.preventDefault();comparisonIndex=-1;attempt(()=>loadComparisonRows(0));});
$('bitwave-comparison-previous').addEventListener('click',()=>{comparisonIndex=-1;attempt(()=>loadComparisonRows(Math.max(0,comparisonRows.offset-PAGE)));});
$('bitwave-comparison-next').addEventListener('click',()=>{comparisonIndex=-1;attempt(()=>loadComparisonRows(comparisonRows.offset+PAGE));});
$('bitwave-comparison-rows').addEventListener('click',event=>{const button=event.target.closest('[data-bitwave-compare-index]');if(!button)return;comparisonIndex=Number(button.dataset.bitwaveCompareIndex);renderComparisonRows();$('bitwave-row-detail').focus({preventScroll:true});});
$('bitwave-return-name').addEventListener('input',invalidatePreview);
$('bitwave-preview-form').addEventListener('submit',event=>{event.preventDefault();attempt(async()=>{
  if(!detail||!captureDetail)throw new Error('Choose a retained received set.');
  const token=++previewToken,plan=selected,capture=captureId,actor=operator(),name=$('bitwave-return-name').value.trim();
  const original=await api('/api/accountant/handoffs/'+encode(detail.plan.handoffId));
  if(token!==previewToken||plan!==selected||capture!==captureId)return;accountant=original;
  const request={id:crypto.randomUUID(),actor,name,expectedParentId:parentId()};
  const result=await api(base()+'/captures/'+encode(capture)+'/preview',request);
  if(token!==previewToken||plan!==selected||capture!==captureId)return;
  const p=result.preview,r=p?.revision;
  if(p===null&&result.comparison){clearPreviewDownload();preview={planId:plan,captureId:capture,value:result,request:{...request,revision}};renderPreview();renderAccountant();showView('return');notify(result.editConflicts?.length?'Reconcile the exported, current local and received bookkeeping values shown below, then preview this retained set again.':'This received set has no return rows ready to save. Review its source comparison and retain the corrected native rows before previewing again.');return;}
  if(!r?.id||!r?.integrity?.sha256||typeof result.csvBase64!=='string')throw new Error('The original accountant preview was incomplete. Refresh this received set and preview again.');
  if(previewUrl)URL.revokeObjectURL(previewUrl);
  const bytes=Uint8Array.from(atob(result.csvBase64),c=>c.charCodeAt(0));previewUrl=URL.createObjectURL(new Blob([bytes],{type:'text/csv;charset=utf-8'}));
  $('bitwave-preview-download').href=previewUrl;$('bitwave-preview-download').download='bitwave-'+plan+'-accountant-return.csv';$('bitwave-preview-download').hidden=false;
  preview={planId:plan,captureId:capture,value:result,request:{id:r.id,revision:p.workspaceRevision,actor,name,expectedParentId:p.expectedParentId??request.expectedParentId,previewSha256:r.integrity.sha256,createdAt:r.createdAt}};
  previewOffset=0;renderPreview();renderAccountant();showView('return');notify('The original accountant matcher has prepared the exact received-row changes for review.');
});});
$('bitwave-apply').addEventListener('click',()=>attempt(async()=>{
  if(!preview?.value?.preview?.revision||preview.planId!==selected||preview.captureId!==captureId)throw new Error('Preview source-matched rows and reconcile bookkeeping conflicts before saving this accountant return.');
  const current=preview;
  await perform({path:base()+'/captures/'+encode(captureId)+'/returns',body:current.request,description:'original accountant return',message:'Matched bookkeeping changes are saved in the original accountant handoff. All prior returns and received files remain available.',success:()=>{invalidatePreview();showView('return');}});
}));
$('bitwave-clear-preview').addEventListener('click',invalidatePreview);
$('bitwave-preview-previous').addEventListener('click',()=>{previewOffset=Math.max(0,previewOffset-PAGE);renderPreview();});
$('bitwave-preview-next').addEventListener('click',()=>{previewOffset+=PAGE;renderPreview();});
$('bitwave-retry').addEventListener('click',()=>{if(pending)attempt(()=>perform(pending,true));});
$('bitwave-dismiss-retry').addEventListener('click',()=>{pending=null;$('bitwave-retry-panel').hidden=true;controls();notify('The submitted form remains available. Refresh the retained plan or operation history before continuing.');});
document.addEventListener('visibilitychange',()=>{if(document.hidden)clearTimeout(pollTimer);else if(running())attempt(()=>selectPlan(selected,{reset:false}));});
window.addEventListener('beforeunload',()=>{clearTimeout(pollTimer);if(previewUrl)URL.revokeObjectURL(previewUrl);});
showView('plan');controls();attempt(refresh);
