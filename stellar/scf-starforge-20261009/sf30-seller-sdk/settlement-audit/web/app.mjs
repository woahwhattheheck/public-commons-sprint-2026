// MIT. Source-owned operator interface. Exact values remain strings through forms.
const $=id=>document.getElementById(id),all=selector=>[...document.querySelectorAll(selector)];
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const pretty=value=>JSON.stringify(value,null,2),values=value=>Object.values(value??{});
const el=(tag,text,className)=>{const node=document.createElement(tag);if(text!==undefined)node.textContent=text;if(className)node.className=className;return node;};
let token=new URLSearchParams(location.hash.slice(1)).get('token');
try{if(token)sessionStorage.setItem('settlement-token:'+location.origin,token);else token=sessionStorage.getItem('settlement-token:'+location.origin);}catch{}
if(location.hash)history.replaceState(null,'',location.pathname+location.search);
let state,catalog=[],referencePolicy,operatorInfo,active=0,activeLabel='',refreshing=null,selectedTab='overview';
let policyBasis=null,batchBasis=null;
let participants=[],contributions=[],contributionOffset=0,sourceOffset=0,sourceListOffset=0,selectedSource=null;
let selectedReconciliation=null,selectedPlan=null,legOffset=0,historyOffset=0,historyResult=null,reportObjectURL=null;
const pageSize=100,pendingRequests=new Map();
function error(message,code='INVALID_INPUT'){const problem=new Error(message);problem.code=code;return problem;}
function notify(message,problem=false){$('notice').hidden=false;$('notice').className=problem?'error':'';$('notice').textContent=message;}
function hideNotice(){$('notice').hidden=true;}
function showError(problem){notify((problem.code?problem.code+': ':'')+problem.message+(problem.details&&Object.keys(problem.details).length?'\n'+pretty(problem.details):''),true);}
function busy(label,delta){active+=delta;activeLabel=label||activeLabel;$('activity').hidden=active===0&&pendingRequests.size===0;$('activity-text').textContent=active?activeLabel:pendingRequests.size+' original request'+(pendingRequests.size===1?'':'s')+' awaiting a complete response. Retry to recover the recorded result.';$('retry-request').hidden=pendingRequests.size===0||active>0;}
function headers(extra={}){return {...extra,Authorization:'Bearer '+(token??'')};}
async function request(path,options={}){
  let response;
  try{response=await fetch(path,{cache:'no-store',...options,headers:headers(options.headers)});}
  catch(cause){throw error('The operator connection was interrupted. Reopen the complete workspace link or retry the original request.','CONNECTION_INTERRUPTED');}
  if(!response.ok){let body;try{body=await response.json();}catch{throw error('The operator returned HTTP '+response.status+'.','HTTP_'+response.status);}
    const problem=error(body.error?.message??'The operation failed.',body.error?.code??'OPERATOR_ERROR');problem.details=body.error?.details;throw problem;}
  return response;
}
async function responseJSON(response){try{return await response.json();}catch{throw error('The operator response ended before its complete result arrived. Recover the original request.','CONNECTION_INTERRUPTED');}}
async function read(method,args={}){return responseJSON(await request('/api/invoke',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({method,args})}));}
async function mutate(method,args={},label='Saving workspace'){
  if(!state)throw error('Open the workspace before changing it.');
  const requestBody={method,args:{...args,requestId:args.requestId??crypto.randomUUID(),
    ...(method!=='delivery.receive'?{expectedRevision:args.expectedRevision??state.revision}:{})}};
  const pendingId=requestBody.args.requestId;pendingRequests.set(pendingId,{kind:'method',...requestBody});busy(label,1);
  try{
    const result=await read(requestBody.method,requestBody.args);pendingRequests.delete(pendingId);
    await refresh(true).catch(showError);return result;
  }catch(problem){if(problem.code!=='CONNECTION_INTERRUPTED')pendingRequests.delete(pendingId);throw problem;}
  finally{busy('',-1);}
}
async function importOriginal(file,args,label){
  const metadata={...args,filename:file.name,contentType:file.type||'application/octet-stream',
    requestId:args.requestId??crypto.randomUUID(),expectedRevision:args.expectedRevision??state.revision};
  const pendingId=metadata.requestId;pendingRequests.set(pendingId,{kind:'source',file,metadata});
  busy(label||'Retaining original source',1);
  try{
    const encoded=btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(metadata))));
    const result=await responseJSON(await request('/api/sources/import',{method:'POST',headers:{'Content-Type':'application/octet-stream','X-Settlement-Source':encoded},body:file}));
    pendingRequests.delete(pendingId);await refresh(true).catch(showError);return result;
  }catch(problem){if(problem.code!=='CONNECTION_INTERRUPTED')pendingRequests.delete(pendingId);throw problem;}
  finally{busy('',-1);}
}
async function download(path,filename,{preview=false}={}){
  let handle=null;
  if(!preview&&typeof window.showSaveFilePicker==='function'){
    try{handle=await window.showSaveFilePicker({suggestedName:filename});}
    catch(problem){if(problem.name==='AbortError')return;throw problem;}
  }
  busy(preview?'Opening retained report':'Downloading complete file',1);
  let writable=null;
  try{
    const response=await request(path);
    if(handle&&response.body){writable=await handle.createWritable();await response.body.pipeTo(writable);writable=null;return;}
    const blob=await response.blob(),url=URL.createObjectURL(blob);
    if(preview){if(reportObjectURL)URL.revokeObjectURL(reportObjectURL);reportObjectURL=url;$('report-preview').src=url;$('report-preview').hidden=false;$('report-preview').scrollIntoView({behavior:'smooth'});}
    else{const link=el('a');link.href=url;link.download=filename;document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);}
  }catch(problem){if(writable)await writable.abort().catch(()=>{});throw problem;}
  finally{busy('',-1);}
}

function tab(name){
  selectedTab=name;all('[data-section]').forEach(section=>section.hidden=section.id!==name);
  all('nav [data-tab]').forEach(button=>button.classList.toggle('selected',button.dataset.tab===name));
  if(name==='history')loadHistory().catch(showError);
}
function field(form,name){return form.elements.namedItem(name);}
function text(form,name){return String(field(form,name)?.value??'').trim();}
function optionalJSON(value,fallback){if(!value.trim())return fallback;try{return JSON.parse(value);}catch{throw error('Enter complete JSON in the additional-fields input.');}}
function whole(value,name){if(!/^\d+$/.test(String(value)))throw error(name+' must be a whole nonnegative number.');const n=Number(value);if(!Number.isSafeInteger(n))throw error(name+' exceeds the supported integer range.');return n;}
function rational(value,divisor=1n){
  const input=String(value).trim();let n,d;
  if(/^\d+\/[1-9]\d*$/.test(input)){const pair=input.split('/');n=BigInt(pair[0]);d=BigInt(pair[1]);}
  else{if(!/^\d+(?:\.\d+)?$/.test(input))throw error('Use a positive decimal or an exact numerator/denominator ratio.');
    const [a,b='']=input.split('.');n=BigInt(a+b);d=10n**BigInt(b.length);}
  d*=divisor;let a=n,b=d;while(b){const next=a%b;a=b;b=next;}const gcd=a||1n;
  return {numerator:String(n/gcd),denominator:String(d/gcd)};
}
function ratioText(value,multiplier=1n){
  let n=BigInt(value.numerator)*multiplier,d=BigInt(value.denominator),a=n,b=d;while(b){const r=a%b;a=b;b=r;}n/=a||1n;d/=a||1n;
  let scale=d;while(scale%2n===0n)scale/=2n;while(scale%5n===0n)scale/=5n;
  if(scale!==1n)return String(n)+'/'+String(d);
  const integer=n/d;let remainder=n%d,decimals='';while(remainder){remainder*=10n;decimals+=String(remainder/d);remainder%=d;}
  return String(integer)+(decimals?'.'+decimals:'');
}
function select(id,rows,{blank=null}={}){
  const element=$(id),previous=element.value;
  element.innerHTML=(blank!==null?'<option value="">'+esc(blank)+'</option>':'')+rows.map(row=>'<option value="'+esc(row.value??row.id)+'">'+esc(row.label??row.name??row.id)+'</option>').join('');
  if([...element.options].some(option=>option.value===previous))element.value=previous;
}
function versions(table){return values(table).flatMap(item=>[...item.versions].reverse().map(version=>({value:item.id+'@'+version.version,label:item.name+' · version '+version.version})));}
function versionSelection(value){const [id,version]=value.split('@');return {id,version:version?whole(version,'version'):undefined};}
function status(value){return '<span class="status '+(['FAILED','MISMATCH','AMBIGUOUS','ATTENTION'].includes(value)?'attention':'')+'">'+esc(value??'')+'</span>';}
function table(columns,rows){return rows.length?'<div class="table-scroll"><table><thead><tr>'+columns.map(value=>'<th>'+esc(value)+'</th>').join('')+'</tr></thead><tbody>'+rows.map(row=>'<tr>'+row.map(value=>'<td>'+value+'</td>').join('')+'</tr>').join('')+'</tbody></table></div>':'<p class="empty">No records in this selection.</p>';}
function action(name,label,id='',extra=''){return '<button type="button" data-action="'+esc(name)+'" data-id="'+esc(id)+'" '+extra+'>'+esc(label)+'</button>';}
function short(value){const s=String(value??'');return s.length>27?s.slice(0,14)+'…'+s.slice(-9):s;}
function date(value){return value?new Date(value).toLocaleString():'';}
function size(bytes){return bytes<1024?bytes+' B':bytes<1024**2?(bytes/1024).toFixed(1)+' KB':bytes<1024**3?(bytes/1024**2).toFixed(1)+' MB':(bytes/1024**3).toFixed(2)+' GB';}
function position(summary){
  if(!summary)return '<p class="empty">Create a reconciliation edition to review the settlement position.</p>';
  const amounts=summary.phases?Object.entries(summary.phases).map(([phase,value])=>[phase,value.matched,value.expected]):
    [['Revenue',summary.grossMatched,summary.grossExpected],['Authority',summary.authorityMatched,summary.authorityExpected],
      ['Driver pool',summary.driverPoolMatched,summary.driverPoolExpected],['Platform',summary.platformMatched,summary.platformExpected],
      ['Driver payouts',summary.driverPayoutMatched,summary.driverPayoutExpected]];
  return '<p>'+status(summary.status)+' <span class="help">'+esc(summary.legCount)+' settlement legs · '+esc(summary.exceptionCount)+' exceptions</span></p><div class="position-grid">'+amounts.map(([label,matched,expected])=>'<div class="position-item"><span>'+esc(label)+'</span><strong>'+esc(matched??'0')+'</strong><span>matched of '+esc(expected??'0')+'</span></div>').join('')+'</div>';
}
function render(){
  $('workspace-name').textContent=state.profile.name;$('workspace-revision').textContent='Revision '+state.revision;
  $('workspace-footer').textContent=state.workspaceId+' · '+operatorInfo.workspaceDirectory;
  const counts=state.counts??{},recons=values(state.reconciliations).sort((a,b)=>b.createdAt.localeCompare(a.createdAt));
  $('metrics').innerHTML=[['SETTLEMENT PLANS',counts.plans??0,'Immutable allocation editions'],['SOURCE RESPONSES',counts.sources??0,values(state.captures).filter(row=>row.status==='COMPLETE').length+' completed captures'],['OPEN EXCEPTIONS',recons[0]?.summary?.exceptionCount??0,'Latest reconciliation edition'],['PARTNER REPORTS',counts.reports??0,'Retained report packages']].map(([label,value,detail])=>'<div class="metric"><span class="label">'+label+'</span><span class="value">'+esc(value)+'</span><span class="detail">'+esc(detail)+'</span></div>').join('');
  $('latest-position').innerHTML=position(recons[0]?.summary);
  $('overview-captures').innerHTML=values(state.captures).slice(-5).reverse().map(row=>'<div class="list-item"><div><strong>'+esc(row.name)+'</strong><small>'+esc(row.provider)+' · '+row.sources.length+' retained responses</small></div>'+status(row.status)+'</div>').join('')||'<p class="empty">No source captures yet.</p>';
  $('overview-reports').innerHTML=values(state.reports).slice(-5).reverse().map(row=>'<div class="list-item"><div><strong>'+esc(row.name)+'</strong><small>'+esc(row.partnerId??'Complete programme')+'</small></div>'+action('show-report','Open',row.id)+'</div>').join('')||'<p class="empty">No report editions yet.</p>';
  select('policy-edit',versions(state.policies),{blank:'New policy'});select('batch-edit',versions(state.batches),{blank:'New settlement'});
  select('batch-policy',versions(state.policies),{blank:values(state.policies).length?null:'Save a policy first'});
  const plans=values(state.plans).map(row=>({id:row.id,label:row.name+' · '+date(row.createdAt)}));
  for(const id of ['reconcile-plan','correction-plan'])select(id,plans,{blank:plans.length?null:'Create an allocation plan'});
  for(const id of ['reconciliation-select','report-reconciliation','compare-left','compare-right'])select(id,recons.map(row=>({id:row.id,label:row.name+' · '+date(row.createdAt)})),{blank:recons.length?null:'No reconciliation editions'});
  select('export-report',values(state.reports).map(row=>({id:row.id,label:row.name+' · '+(row.partnerId??'Programme')})),{blank:'Select a report'});
  select('correction-source',values(state.sources).filter(row=>row.provider!=='document').map(row=>({id:row.id,label:row.label+' · '+row.kind+' · '+short(row.id)})),{blank:'All retained sources in selected scope'});
  $('plans-list').innerHTML=table(['Plan','Gross revenue','Authority','Driver pool','Platform','Driver payouts',''],values(state.plans).slice().reverse().map(row=>[
    esc(row.name)+'<span class="secondary">'+esc(date(row.createdAt))+'</span>',esc(row.totals.grossAmount),esc(row.totals.authorityAmount),
    esc(row.totals.driverPoolAmount),esc(row.totals.platformAmount),esc(row.totals.driverPayoutAmount),action('use-plan','Reconcile',row.id)]));
  $('captures-list').innerHTML=table(['Capture','Source','Status','Responses','Latest observation',''],values(state.captures).slice().reverse().map(row=>[
    '<strong>'+esc(row.name)+'</strong><span class="secondary">'+esc(row.read.kind)+' · '+esc(short(row.id))+'</span>',
    esc(row.connectionAlias),status(row.status),esc(row.sources.length),esc(date(row.updatedAt))+(row.lastError?'<span class="secondary">'+esc(row.lastError.message)+'</span>':''),
    ['READY','RUNNING'].includes(row.status)?action('capture-pause','Pause',row.id)+' '+action('capture-run','Continue',row.id):row.status==='COMPLETE'?action('capture-sources','View sources',row.id):action('capture-run','Resume',row.id)]));
  renderSources();renderReports();renderDeliveries();
  const prior=new Map(all('#reconcile-sources input').map(input=>[input.value,input.checked]));
  $('reconcile-sources').innerHTML=values(state.sources).filter(row=>row.provider!=='document').map(row=>'<label><input type="checkbox" value="'+esc(row.id)+'" '+((prior.has(row.id)?prior.get(row.id):true)?'checked':'')+'><span>'+esc(row.label)+' · '+esc(row.provider+'/'+row.kind)+' · '+esc(row.selectedRecords)+' records'+(row.error?' · '+esc(row.error.code):'')+'</span></label>').join('');
  if(selectedReconciliation)renderReconciliation();
}
async function refresh(following=false){
  if(refreshing){await refreshing;if(following)return refresh();return;}
  refreshing=(async()=>{state=await responseJSON(await request('/api/state'));render();})();
  try{return await refreshing;}finally{refreshing=null;}
}
function renderConnections(){
  $('connection-list').innerHTML=table(['Alias','Source','Network','Origin'],catalog.map(row=>[esc(row.connection.alias),esc(row.connection.provider),esc(row.catalog.network),esc(row.catalog.origin)]));
  $('connection-location').textContent=operatorInfo.connectionsFile??'Start with --connections-file /absolute/private/connections.json. The application includes examples/connections.example.json.';
  select('capture-connection',catalog.map(row=>({value:row.connection.alias,label:row.connection.alias+' · '+row.connection.provider})),{blank:catalog.length?null:'Configure a source connection'});
  configureCaptureKinds();
}
function configureCaptureKinds(){
  const source=catalog.find(row=>row.connection.alias===$('capture-connection').value);
  select('capture-kind',Object.keys(source?.catalog.kinds??{}).map(kind=>({value:kind,label:kind})),{blank:source?null:'Select a connection'});configureCaptureFields();
}
function configureCaptureFields(){
  const source=catalog.find(row=>row.connection.alias===$('capture-connection').value),kind=$('capture-kind').value,entry=source?.catalog.kinds[kind];
  $('capture-id-field').hidden=!entry||entry.shape!=='object'||kind==='root';
  const form=$('capture-form');field(form,'pageSize').disabled=!entry||entry.shape!=='page';field(form,'pageSize').max=entry?.maximumPageSize??200;
  for(const key of ['fromLedger','throughLedger'])field(form,key).disabled=source?.connection.provider!=='horizon';
  const labels={accountId:'Account scope',transactionHash:'Transaction hash scope',ledger:'Ledger scope',order:'Original order',include_failed:'Include failed operations',
    join:'Transaction join',q:'Search',status:'Native status',created_at_after:'Created after',created_at_before:'Created before',sort:'Sort field',direction:'Sort direction',
    receiver_id:'Receiver ID',type:'Payment type',enabled:'Enabled',include_deleted:'Include deleted wallets',user_managed:'User managed',supported_assets:'Supported asset IDs'};
  $('capture-filters').innerHTML=(entry?.filters??[]).map(key=>{
    const title=labels[key]??key;
    if(['include_failed','enabled','include_deleted','user_managed'].includes(key))return '<label>'+esc(title)+'<select data-filter="'+esc(key)+'"><option value="">Provider default</option><option value="true">Yes</option><option value="false">No</option></select></label>';
    if(['order','direction'].includes(key))return '<label>'+esc(title)+'<select data-filter="'+esc(key)+'"><option value="asc">Ascending</option><option value="desc">Descending</option></select></label>';
    if(key==='join')return '<label>'+esc(title)+'<select data-filter="join"><option value="transactions">Include original transaction</option></select></label>';
    if(key==='sort')return '<label>'+esc(title)+'<select data-filter="sort">'+(entry.sorts??[]).map(value=>'<option '+(value===entry.sort?'selected ':'')+'value="'+esc(value)+'">'+esc(value)+'</option>').join('')+'</select></label>';
    return '<label>'+esc(title)+'<input data-filter="'+esc(key)+'" '+(key.startsWith('created_at_')?'type="date"':'')+'></label>';
  }).join('');
}
function renderSources(){
  const query=$('source-search').value.trim().toLowerCase(),rows=values(state.sources).slice().reverse().filter(row=>!query||[row.label,row.kind,row.id,row.captureId].join(' ').toLowerCase().includes(query));
  sourceListOffset=Math.min(sourceListOffset,Math.max(0,Math.floor((rows.length-1)/pageSize)*pageSize));
  $('sources-list').innerHTML=table(['Original source','Provider / kind','Records','Observed',''],rows.slice(sourceListOffset,sourceListOffset+pageSize).map(row=>[
    esc(row.label)+'<span class="secondary">'+esc(short(row.id))+'</span>',esc(row.provider+' / '+row.kind),esc(row.selectedRecords)+(row.error?'<span class="secondary">'+esc(row.error.code)+'</span>':''),
    esc(date(row.observedAt)),action('source-read','Read',row.id)]))+'<div class="pager">'+action('source-list-prev','Previous')+'<span>'+Math.min(sourceListOffset+1,rows.length)+'–'+Math.min(sourceListOffset+pageSize,rows.length)+' of '+rows.length+'</span>'+action('source-list-next','Next')+'</div>';
}
function renderSource(){
  if(!selectedSource)return;const source=selectedSource.source,rows=selectedSource.records??[];
  $('source-detail').hidden=false;$('source-detail-title').textContent=source.label+' · '+source.kind;
  $('source-metadata').innerHTML='<p class="help">'+esc(source.provider)+' · '+esc(date(source.observedAt))+' · '+esc(size(source.bodyFile.bytes))+' · '+esc(rows.length)+' projected records</p>'+(source.error?'<div class="exception">'+esc(source.error.message)+'</div>':'');
  $('source-records').innerHTML=table(['Record ID','Native state','Amount / asset','Transaction',''],rows.slice(sourceOffset,sourceOffset+pageSize).map((row,index)=>[
    esc(row.id),status(row.projection?.status),esc(row.projection?.amount??'')+' '+esc(row.projection?.asset?.code??(row.projection?.asset?.type==='native'?'XLM':'')),
    esc(short(row.projection?.transactionHash)),action('source-record','Original record',String(index+sourceOffset))]));
  $('source-page').textContent=Math.min(sourceOffset+1,rows.length)+'–'+Math.min(sourceOffset+pageSize,rows.length)+' of '+rows.length;
  $('source-prev').disabled=sourceOffset===0;$('source-next').disabled=sourceOffset+pageSize>=rows.length;
  $('source-detail-json').textContent=pretty(source);
  const form=$('source-project-form');
  if(form.dataset.sourceId!==source.id){form.dataset.sourceId=source.id;
    field(form,'provider').value=source.provider==='horizon'?'horizon':'sdp';field(form,'kind').value=source.provider==='document'?'payments':source.kind;
    field(form,'recordsPath').value=source.recordsPath===null?'$':source.recordsPath??(source.provider==='horizon'? '/_embedded/records':'/data');
    field(form,'network').value=source.network??'';
  }
}
function renderParticipants(){
  const options=(values,current)=>values.map(value=>'<option value="'+esc(value)+'" '+(value===current?'selected':'')+'>'+esc(value)+'</option>').join('');
  const input=(row,key,index,cls='')=>'<input data-participant="'+index+'" data-field="'+key+'" class="'+cls+'" value="'+esc(row[key]??'')+'">';
  $('participants-table').tBodies[0].innerHTML=participants.map((row,index)=>'<tr><td>'+input(row,'id',index)+'</td><td><select data-participant="'+index+'" data-field="role">'+options(['authority','driver_pool','platform','driver'],row.role)+'</select></td><td>'+input(row,'account',index,'account')+'</td><td>'+input(row,'partnerId',index)+'</td><td>'+input(row,'label',index)+'</td><td><select data-participant="'+index+'" data-field="memoType">'+options(['none','text','id','hash','return'],row.memoType??'none')+'</select></td><td>'+input(row,'memoValue',index)+'</td><td>'+input(row,'weight',index,'small')+'</td><td><input type="checkbox" data-participant="'+index+'" data-field="retain" '+(row.retain?'checked':'')+'></td><td>'+action('participant-remove','Remove',String(index))+'</td></tr>').join('');
}
function renderContributions(){
  const input=(row,key,index)=>'<input data-contribution="'+index+'" data-field="'+key+'" value="'+esc(row[key]??'')+'">';
  const view=contributions.slice(contributionOffset,contributionOffset+pageSize);
  $('contributions-table').tBodies[0].innerHTML=view.map((row,i)=>{const index=i+contributionOffset;return '<tr><td><input type="checkbox" data-contribution="'+index+'" data-field="approved" '+(row.approved?'checked':'')+'></td><td>'+input(row,'id',index)+'</td><td>'+input(row,'participantId',index)+'</td><td>'+input(row,'units',index)+'</td><td><select data-contribution="'+index+'" data-field="tier">'+['SCOUT1','SCOUT2','SCOUT3'].map(tier=>'<option '+(row.tier===tier?'selected ':'')+'value="'+tier+'">'+tier+'</option>').join('')+'</select></td><td>'+esc(short(row.sourceRef?.sourceId??''))+'</td><td>'+action('contribution-remove','Remove',String(index))+'</td></tr>';}).join('');
  $('contribution-count').textContent=contributions.length+' contribution rows · '+contributions.filter(row=>row.approved).length+' approved';
  $('contribution-page').textContent=Math.min(contributionOffset+1,contributions.length)+'–'+Math.min(contributionOffset+pageSize,contributions.length)+' of '+contributions.length;
  $('contribution-prev').disabled=contributionOffset===0;$('contribution-next').disabled=contributionOffset+pageSize>=contributions.length;
}
function renderReconciliation(){
  const data=selectedReconciliation?.data;if(!data){$('reconciliation-summary').innerHTML=position(null);return;}
  $('reconciliation-summary').innerHTML=position(data.summary);
  const query=$('leg-search').value.trim().toLowerCase(),selectedStatus=$('leg-status').value;
  const rows=data.legs.filter(row=>(!selectedStatus||row.status===selectedStatus)&&(!query||[row.participantId,row.toAccount,...row.matches.map(match=>match.transactionHash)].join(' ').toLowerCase().includes(query)));
  legOffset=Math.min(legOffset,Math.max(0,Math.floor((rows.length-1)/pageSize)*pageSize));
  $('legs-list').innerHTML=table(['Stage / role','Recipient','Expected amount','State','Original payment trail',''],rows.slice(legOffset,legOffset+pageSize).map(row=>[
    esc(row.phase+' / '+row.role),esc(row.participantId??'Treasury')+'<span class="secondary">'+esc(short(row.toAccount))+'</span>',esc(row.amount),status(row.status),
    row.matches.map(match=>esc(short(match.transactionHash??match.kind??''))+(match.ledger?'<span class="secondary">Ledger '+esc(match.ledger)+'</span>':'')).join('<br>'),action('correct-leg','Correct',row.id)]));
  $('legs-page').textContent=Math.min(legOffset+1,rows.length)+'–'+Math.min(legOffset+pageSize,rows.length)+' of '+rows.length;
  $('legs-prev').disabled=legOffset===0;$('legs-next').disabled=legOffset+pageSize>=rows.length;
  $('exceptions-list').innerHTML=data.exceptions.slice(0,100).map(item=>'<div class="exception"><strong>'+esc(item.code)+'</strong><p>'+esc(item.message)+'</p>'+(item.legId?action('correct-leg','Review assignment',item.legId):'')+'</div>').join('')+(data.exceptions.length>100?'<p class="help">Showing the first 100 exceptions. Filter the settlement rows to review all affected legs; complete exceptions are retained in the report.</p>':'');
  select('correction-leg',data.legs.map(row=>({id:row.id,label:row.phase+' / '+row.role+' / '+(row.participantId??'Treasury')})),{blank:'Select a settlement leg'});
}
function renderReports(){
  $('reports-list').innerHTML=table(['Report','Partner','Created','Files'],values(state.reports).slice().reverse().map(row=>[
    esc(row.name),esc(row.partnerId??'Complete programme'),esc(date(row.createdAt)),
    row.files.map(file=>action(file.filename.endsWith('.html')?'report-preview':'report-download',file.filename.endsWith('.html')?'Preview HTML':file.filename.endsWith('.csv')?'Download CSV':'Download JSON',row.id,'data-file="'+esc(file.filename)+'"')).join(' ')]));
}
function renderDeliveries(){
  $('deliveries-list').innerHTML=table(['Delivery','Kind','Files / size','Manifest',''],values(state.deliveries).slice().reverse().map(row=>[
    esc(row.directory),esc(row.kind),esc(row.files)+' / '+esc(size(row.bytes)),esc(short(row.manifestSha256)),action('delivery-download','Download complete archive',row.deliveryId)]));
}
async function loadReconciliation(id){
  if(!id)return;const edition=await read('edition.read',{kind:'reconciliation',id});selectedReconciliation=edition;legOffset=0;
  selectedPlan=await read('edition.read',{kind:'plan',id:edition.planId});
  $('reconciliation-select').value=id;$('correction-plan').value=edition.planId;
  $('partner-options').innerHTML=[...new Set((selectedPlan.data.participants??[]).map(row=>row.partnerId).filter(Boolean))].map(id=>'<option value="'+esc(id)+'"></option>').join('');
  renderReconciliation();
}
async function loadHistory(){
  if(!state)return;historyResult=await read('workspace.history',{offset:historyOffset,limit:pageSize});
  $('history-list').innerHTML=table(['Revision','Time','Operation','Request',''],historyResult.records.map(row=>[
    esc(row.revision),esc(date(row.at)),esc(row.operation),esc(short(row.requestId)),action('history-detail','Details',String(row.revision))]));
  $('history-page').textContent=Math.min(historyOffset+1,historyResult.total)+'–'+Math.min(historyOffset+pageSize,historyResult.total)+' of '+historyResult.total;
  $('history-prev').disabled=historyOffset===0;$('history-next').disabled=historyResult.nextOffset===null;
}

function parseCSV(body){
  const rows=[];let row=[],value='',quoted=false,closed=false;const input=body.replace(/^\uFEFF/,'');
  const cell=()=>{row.push(value);value='';closed=false;};const line=()=>{cell();if(row.some(value=>value!==''))rows.push(row);row=[];};
  for(let i=0;i<input.length;i++){
    const c=input[i];
    if(quoted){if(c==='"'){if(input[i+1]==='"'){value+='"';i++;}else{quoted=false;closed=true;}}else value+=c;continue;}
    if(closed&&![' ',',','\n','\r','\t'].includes(c))throw error('Unexpected content after a quoted CSV field.');
    if(c==='"'){if(value)throw error('A CSV quotation must begin at the start of its field.');quoted=true;}
    else if(c===',')cell();else if(c==='\n')line();else if(c==='\r'){if(input[i+1]==='\n')i++;line();}
    else if(!closed)value+=c;
  }
  if(quoted)throw error('The original CSV ends inside a quoted field.');
  if(value||row.length||closed)line();
  if(!rows.length)throw error('The CSV needs a header row.');
  const names=rows.shift().map(value=>value.trim());
  if(names.some(value=>!value)||new Set(names).size!==names.length)throw error('CSV headers must be nonempty and unique.');
  return rows.map((row,index)=>{if(row.length!==names.length)throw error('CSV row '+(index+2)+' has '+row.length+' cells; the header declares '+names.length+'.');
    return Object.fromEntries(names.map((name,i)=>[name,row[i]]));});
}
function boolean(value,name){
  const text=String(value??'').trim().toLowerCase();if(['true','yes','1'].includes(text))return true;if(['false','no','0',''].includes(text))return false;
  throw error(name+' must be true or false.');
}
async function importTable(file,kind){
  if(!file)return;
  const rows=parseCSV(new TextDecoder('utf-8',{fatal:true}).decode(await file.arrayBuffer()));
  const required=kind==='participants'?['id','role','account']:['id','participantId','units','tier','approved'];
  for(const name of required)if(rows.length&&!Object.hasOwn(rows[0],name))throw error('The original '+kind+' CSV needs the '+name+' column.');
  const imported=await importOriginal(file,{provider:'document',kind:'settlement-'+kind,label:'Settlement '+kind+' · '+file.name},'Retaining original '+kind+' table');
  if(kind==='participants'){
    participants=rows.map(row=>({id:row.id.trim(),role:row.role.trim(),account:row.account.trim(),partnerId:row.partnerId?.trim()??'',
      label:row.label??'',memoType:row.memoType?.trim()||'none',memoValue:row.memoValue??'',weight:row.weight?.trim()||'1',
      retain:boolean(row.retain??(row.settlement==='retain'?'true':'false'),'retain'),sourceRef:{sourceId:imported.sourceId,recordId:row.id.trim()}}));
    renderParticipants();
  }else{
    contributions=rows.map(row=>({id:row.id.trim(),participantId:row.participantId.trim(),units:row.units.trim(),tier:row.tier.trim(),
      approved:boolean(row.approved,'approved'),sourceRef:{sourceId:imported.sourceId,recordId:row.id.trim()}}));
    contributionOffset=0;renderContributions();
  }
  notify('Retained the complete original file and loaded '+rows.length+' '+kind+' rows.');
}
async function savePolicy(){
  const form=$('policy-form'),extra=optionalJSON(text(form,'extra'),{});
  if(!extra||Array.isArray(extra)||typeof extra!=='object')throw error('Additional policy fields must be a JSON object.');
  const edited=versionSelection($('policy-edit').value);
  if(edited.id&&policyBasis?.id!==edited.id)throw error('Load the selected policy before saving its following version.');
  const definition={...referencePolicy,...extra,name:text(form,'name'),
    splitMode:text(form,'splitMode'),shares:Object.fromEntries(['authority','drivers','platform'].map(role=>[role,rational(text(form,role),100n)])),
    tiers:Object.fromEntries(['SCOUT1','SCOUT2','SCOUT3'].map(tier=>[tier,{...(extra.tiers?.[tier]??referencePolicy.tiers[tier]),multiplier:rational(text(form,tier))}]))};
  const result=await mutate('policy.save',{...(edited.id?{policyId:edited.id,expectedVersion:policyBasis.version}:{}),name:definition.name,definition},'Saving complete distribution policy');
  policyBasis={id:result.policyId,version:result.version};$('policy-edit').value=result.policyId+'@'+result.version;$('batch-policy').value=$('policy-edit').value;
  notify('Saved policy version '+result.version+'.');return result;
}
async function loadPolicy(){
  const choice=versionSelection($('policy-edit').value);if(!choice.id)return;
  await refresh();policyBasis={id:choice.id,version:state.policies[choice.id].currentVersion};
  const policy=await read('policy.read',{policyId:choice.id,version:choice.version}),definition=policy.definition,form=$('policy-form');
  field(form,'name').value=policy.name;for(const role of ['authority','drivers','platform'])field(form,role).value=ratioText(definition.shares[role],100n);
  for(const tier of ['SCOUT1','SCOUT2','SCOUT3'])field(form,tier).value=ratioText(definition.tiers[tier].multiplier);
  field(form,'splitMode').value=definition.splitMode??'atomic';
  const extra={...definition};for(const key of ['name','shares','splitMode'])delete extra[key];field(form,'extra').value=pretty(extra);
}
async function saveBatch(withPlan=false){
  const form=$('batch-form');if(!form.reportValidity())return;
  const policy=versionSelection(text(form,'policyId'));if(!policy.id)throw error('Save and select the settlement policy first.');
  const edit=versionSelection($('batch-edit').value);
  if(edit.id&&batchBasis?.id!==edit.id)throw error('Load the selected settlement before saving its following version.');
  const asset={type:text(form,'assetType')};
  if(asset.type!=='native'){asset.code=text(form,'assetCode');asset.issuer=text(form,'assetIssuer');}
  const sourceRef=optionalJSON(text(form,'sourceRef'),undefined);
  const definition={policyId:policy.id,policyVersion:policy.version,
    revenue:{id:text(form,'revenueId'),network:text(form,'network'),asset,amount:text(form,'amount'),treasuryAccount:text(form,'treasuryAccount'),
      ...(sourceRef?{sourceRef}:{})},
    participants:participants.map(row=>({id:row.id.trim(),role:row.role,account:row.account.trim(),...(row.partnerId?{partnerId:row.partnerId.trim()}:{}),
      ...(row.label?{label:row.label}:{}),...(row.memoType&&row.memoType!=='none'?{memo:{type:row.memoType,value:row.memoValue}}:{}),
      ...(row.weight?{weight:rational(row.weight)}:{}),settlement:row.retain?'retain':'transfer',...(row.sourceRef?{sourceRef:row.sourceRef}:{})})),
    contributions:contributions.map(row=>({id:row.id.trim(),participantId:row.participantId.trim(),units:row.units.trim(),tier:row.tier,
      approved:Boolean(row.approved),...(row.sourceRef?{sourceRef:row.sourceRef}:{})})),
    assignments:optionalJSON(text(form,'assignments'),[])};
  const result=await mutate('batch.save',{...(edit.id?{batchId:edit.id,expectedVersion:batchBasis.version}:{}),name:text(form,'name'),definition},'Saving complete settlement inputs');
  batchBasis={id:result.batchId,version:result.version};$('batch-edit').value=result.batchId+'@'+result.version;
  if(withPlan){
    const plan=await mutate('plan.create',{batchId:result.batchId,batchVersion:result.version,name:text(form,'name')},'Calculating exact treasury and driver allocations');
    $('reconcile-plan').value=plan.planId;$('correction-plan').value=plan.planId;notify('Saved settlement version '+result.version+' and its complete allocation plan.');tab('reconciliation');
  }else notify('Saved settlement version '+result.version+'.');
  return result;
}
async function loadBatch(){
  const choice=versionSelection($('batch-edit').value);if(!choice.id)return;
  await refresh();batchBasis={id:choice.id,version:state.batches[choice.id].currentVersion};
  const batch=await read('batch.read',{batchId:choice.id,version:choice.version}),input=batch.definition,form=$('batch-form');
  field(form,'name').value=batch.name;field(form,'policyId').value=input.policyId+'@'+input.policyVersion;
  const mapping={revenueId:'id',network:'network',amount:'amount',treasuryAccount:'treasuryAccount'};
  for(const [name,key] of Object.entries(mapping)){
    const value=input.revenue[key]??'';
    if(name==='network'&&![...field(form,name).options].some(option=>option.value===value))field(form,name).append(new Option(value,value));
    field(form,name).value=value;
  }
  field(form,'assetType').value=input.revenue.asset.type;field(form,'assetCode').value=input.revenue.asset.code??'';field(form,'assetIssuer').value=input.revenue.asset.issuer??'';
  field(form,'sourceRef').value=input.revenue.sourceRef?pretty(input.revenue.sourceRef):'';field(form,'assignments').value=pretty(input.assignments??[]);
  participants=input.participants.map(row=>({...row,memoType:row.memo?.type??'none',memoValue:row.memo?.value??'',weight:row.weight?ratioText(row.weight):'1',retain:row.settlement==='retain'}));
  contributions=(input.contributions??[]).map(row=>({...row}));contributionOffset=0;renderParticipants();renderContributions();notify('Loaded original settlement version '+choice.version+'.');
}
async function runCapture(id){
  let capture=state.captures[id];if(!capture)throw error('Select an original source capture.');
  if(['PAUSED','FAILED'].includes(capture.status)){await mutate('capture.resume',{captureId:id},'Resuming original source capture');capture=state.captures[id];}
  if(capture.status==='COMPLETE'){notify('This original capture is complete.');return;}
  const args=capture.run?.args??{captureId:id};
  const result=await mutate('capture.run',args,'Collecting all original native pages — you can pause from the capture list');
  notify(result.status==='COMPLETE'?'Completed the original native source selection.':'Capture '+String(result.status??'updated').toLowerCase()+'.');
  return result;
}
async function startCapture(){
  const form=$('capture-form'),source=catalog.find(row=>row.connection.alias===text(form,'connectionAlias'));
  if(!source)throw error('Select a configured original source connection.');
  const kind=text(form,'kind'),entry=source.catalog.kinds[kind],filters={};
  for(const input of all('#capture-filters [data-filter]'))if(input.value!==''){
    filters[input.dataset.filter]=['include_failed','enabled','include_deleted','user_managed'].includes(input.dataset.filter)?input.value==='true':input.value;
  }
  const readRequest={kind,filters};
  if(entry.shape==='object'&&kind!=='root')readRequest.id=text(form,'id');
  if(entry.shape==='page')readRequest.pageSize=whole(text(form,'pageSize'),'Records per page');
  if(text(form,'cursor'))readRequest.cursor=text(form,'cursor');
  const selection={};if(source.connection.provider==='horizon')for(const key of ['fromLedger','throughLedger'])if(text(form,key))selection[key]=whole(text(form,key),key);
  const result=await mutate('capture.start',{connectionAlias:source.connection.alias,name:text(form,'name'),read:readRequest,selection},'Starting original source capture');
  return runCapture(result.captureId);
}
async function importSource(){
  const form=$('source-import-form'),file=field(form,'file').files[0],recordPath=text(form,'recordsPath');
  if(!file)throw error('Select the complete original source file.');
  const result=await importOriginal(file,{provider:text(form,'provider'),kind:text(form,'kind'),label:text(form,'label'),
    ...(text(form,'network')?{network:text(form,'network')}:{}),...(text(form,'sourceScope')?{sourceScope:text(form,'sourceScope')}:{}),
    ...(recordPath?{recordsPath:recordPath==='$'?null:recordPath}:{})},'Retaining complete original source');
  selectedSource=await read('source.read',{sourceId:result.sourceId});sourceOffset=0;renderSource();notify('Retained the complete original file and its source interpretation.');
}
async function projectSource(){
  if(!selectedSource)throw error('Open the original source first.');
  const form=$('source-project-form'),pointer=text(form,'recordsPath');
  const result=await mutate('source.project',{sourceId:selectedSource.source.id,provider:text(form,'provider'),kind:text(form,'kind'),
    recordsPath:pointer==='$'?null:pointer,...(text(form,'network')?{network:text(form,'network')}:{})},'Retaining the following source interpretation');
  selectedSource=await read('source.read',{sourceId:result.sourceId});sourceOffset=0;renderSource();
  notify('Saved a following interpretation of the retained original response.');
}
async function createReconciliation(){
  const form=$('reconcile-form'),result=await mutate('reconciliation.create',{planId:text(form,'planId'),name:text(form,'name'),
    sourceIds:all('#reconcile-sources input:checked').map(input=>input.value),
    ...(text(form,'asOf')?{asOf:new Date(text(form,'asOf')).toISOString()}:{}),
  },'Reconciling treasury split and original driver payout records');
  await loadReconciliation(result.reconciliationId);notify('Retained the complete reconciliation edition.');
}
async function addCorrection(){
  const form=$('correction-form'),kind=text(form,'kind'),legId=text(form,'legId');
  const correction={kind,reason:text(form,'reason'),...(text(form,'actor')?{actor:text(form,'actor')}:{}),
    ...(text(form,'partnerId')?{partnerId:text(form,'partnerId')}:{})};
  if(kind!=='note'){
    const reference={provider:text(form,'provider'),kind:text(form,'recordKind'),recordId:text(form,'recordId'),
      ...(text(form,'sourceId')?{sourceId:text(form,'sourceId')}:{})};
    if(!reference.recordId)throw error('Select the original record ID.');
    if(kind==='assign'){if(!legId)throw error('Select the settlement leg for this original payment.');correction.assignment={legId,...reference};}
    else correction.recordRef=reference;
  }else{correction.note=correction.reason;if(legId)correction.legId=legId;}
  await mutate('correction.add',{planId:text(form,'planId'),correction},'Appending explained correction');
  notify('Saved the correction. Create a following reconciliation edition to review its effect.');field(form,'reason').value='';
}
async function compareEditions(){
  const form=$('compare-form'),result=await read('reconciliation.compare',{leftId:text(form,'leftId'),rightId:text(form,'rightId')});
  $('comparison-result').innerHTML='<p class="help">'+esc(result.legs.length)+' changed participant / stage records · '+result.sourceChanges.added.length+' added source responses · '+result.correctionChanges.added.length+' added corrections</p>'+
    table(['Stage / participant','Change','Baseline','Following'],result.legs.map(row=>[
      esc((row.after??row.before).phase+' / '+((row.after??row.before).participantId??'Treasury')),esc(row.change),
      row.before?status(row.before.status)+' '+esc(row.before.amount):'—',row.after?status(row.after.status)+' '+esc(row.after.amount):'—']));
}
async function createReport(){
  const form=$('report-form'),result=await mutate('report.create',{reconciliationId:text(form,'reconciliationId'),name:text(form,'name'),
    ...(text(form,'partnerId')?{partnerId:text(form,'partnerId')}:{})},'Creating complete scoped partner reports');
  $('export-report').value=result.reportId;notify('Created the retained HTML, JSON and CSV report edition.');
}
async function exportDelivery(){
  const form=$('export-form'),kind=text(form,'kind'),args={name:text(form,'name'),destination:text(form,'destination'),
    ...(kind==='report'?{reportId:text(form,'reportId'),includeApplication:field(form,'includeApplication').checked}:{})};
  const result=await mutate(kind==='workspace'?'workspace.export':'report.export',args,'Exporting complete original source and selected client work');
  notify('Prepared '+result.files+' complete files ('+size(result.bytes)+'). Download the archive from the delivery list.');
}
async function unpackDelivery(){
  const form=$('unpack-form'),file=field(form,'archive').files[0];if(!file)throw error('Select a complete delivery archive.');
  const requestId=crypto.randomUUID(),manifestHash=text(form,'manifestSha256'),query=new URLSearchParams({requestId,...(manifestHash?{manifestSha256:manifestHash}:{})});
  busy('Receiving and inspecting the complete archive',1);
  try{
    const result=await (await request('/api/deliveries/unpack?'+query,{method:'POST',headers:{'Content-Type':'application/gzip'},body:file})).json();
    $('unpack-result').innerHTML='<div class="exception"><strong>'+esc(result.manifest.name)+'</strong><p>'+esc(result.manifest.kind)+' · '+result.manifest.files.length+' original files · '+size(result.bytes)+'</p><p>Workspace '+esc(result.manifest.workspaceId)+' · revision '+result.manifest.workspaceRevision+'</p></div>';
    const receive=$('receive-form');field(receive,'sourceDirectory').value=result.sourceDirectory;field(receive,'expectedManifestSha256').value=result.manifestSha256;
    if(!text(receive,'destination'))field(receive,'destination').value=operatorInfo.workspaceDirectory+'.received-'+requestId.slice(0,8);
    notify('Inspected the complete original delivery. Its source and manifest are selected for receiving.');
  }finally{busy('',-1);}
}
function shellArg(value){return "'"+String(value).replaceAll("'","'\\''")+"'";}
async function receiveDelivery(){
  const form=$('receive-form'),result=await mutate('delivery.receive',{sourceDirectory:text(form,'sourceDirectory'),
    destination:text(form,'destination'),expectedManifestSha256:text(form,'expectedManifestSha256')},'Receiving a complete continuing workspace');
  $('receive-result').replaceChildren();
  const box=el('div',undefined,'exception');box.append(el('strong','Received '+result.kind+' delivery'),el('p',result.directory));
  if(result.workspace){
    box.append(el('p','Original workspace '+result.workspace.workspaceId+' · revision '+result.workspace.revision));
    const command='node '+shellArg(result.application.cli)+' serve --workspace '+shellArg(result.workspace.directory)+' --expected-workspace-id '+shellArg(result.workspace.workspaceId)+
      (operatorInfo.connectionsFile?' --connections-file '+shellArg(operatorInfo.connectionsFile):'');
    box.append(el('p','Open the received application:'),el('pre',command));
  }else box.append(el('p','Report: '+result.report.html));
  $('receive-result').append(box);notify('Received the complete delivery with its original source and workspace history.');
}

function correctLeg(id){
  const leg=selectedReconciliation?.data.legs.find(row=>row.id===id);if(!leg)return;
  const form=$('correction-form');field(form,'planId').value=selectedReconciliation.planId;field(form,'legId').value=leg.id;
  field(form,'kind').value='assign';$('correction-record-fields').hidden=false;
  const refs=leg.matches.flatMap(match=>match.recordRefs??[]),ref=refs.find(row=>row.provider===(leg.provider??'horizon'))??refs[0];
  if(ref){for(const [name,key] of [['provider','provider'],['recordKind','kind'],['recordId','recordId'],['sourceId','sourceId']])field(form,name).value=ref[key]??'';}
  form.scrollIntoView({behavior:'smooth'});field(form,'reason').focus();
}
async function actionClick(button){
  const id=button.dataset.id,kind=button.dataset.action;
  if(kind==='participant-remove'){participants.splice(Number(id),1);renderParticipants();return;}
  if(kind==='contribution-remove'){contributions.splice(Number(id),1);contributionOffset=Math.min(contributionOffset,Math.max(0,Math.floor((contributions.length-1)/pageSize)*pageSize));renderContributions();return;}
  if(kind==='capture-run')return runCapture(id);
  if(kind==='capture-pause'){await mutate('capture.pause',{captureId:id},'Pausing the selected original capture');notify('Paused the capture. Its original continuation is retained.');return;}
  if(kind==='capture-sources'){$('source-search').value=id;sourceListOffset=0;renderSources();$('sources-list').scrollIntoView({behavior:'smooth'});return;}
  if(kind==='source-read'){selectedSource=await read('source.read',{sourceId:id});sourceOffset=0;renderSource();$('source-detail').scrollIntoView({behavior:'smooth'});return;}
  if(kind==='source-record'){const record=selectedSource?.records[Number(id)];if(record){$('source-detail-json').textContent=pretty(record);$('source-detail-json').parentElement.open=true;}return;}
  if(kind==='source-list-prev'){sourceListOffset=Math.max(0,sourceListOffset-pageSize);renderSources();return;}
  if(kind==='source-list-next'){sourceListOffset+=pageSize;renderSources();return;}
  if(kind==='use-plan'){$('reconcile-plan').value=id;tab('reconciliation');return;}
  if(kind==='correct-leg'){correctLeg(id);return;}
  if(kind==='history-detail'){const record=historyResult?.records.find(row=>row.revision===Number(id));if(record){$('history-detail').hidden=false;$('history-detail').open=true;$('history-detail').querySelector('pre').textContent=pretty(record);}return;}
  if(kind==='show-report'){tab('reports');const report=state.reports[id],file=report?.files.find(row=>row.filename.endsWith('.html'));if(file)return download('/api/reports/'+encodeURIComponent(id)+'/files/'+encodeURIComponent(file.filename),file.filename,{preview:true});return;}
  if(kind==='report-download'||kind==='report-preview')return download('/api/reports/'+encodeURIComponent(id)+'/files/'+encodeURIComponent(button.dataset.file),button.dataset.file,{preview:kind==='report-preview'});
  if(kind==='delivery-download')return download('/api/deliveries/'+encodeURIComponent(id)+'/archive','settlement-'+id+'.tar.gz');
}
const submit={
  'profile-form':async()=>{const form=$('profile-form');await mutate('workspace.profile',{profile:{...state.profile,name:text(form,'name'),organization:text(form,'organization'),contact:text(form,'contact')}},'Saving programme details');notify('Saved programme details.');},
  'policy-form':savePolicy,'batch-form':()=>saveBatch(false),'capture-form':startCapture,
  'source-import-form':importSource,'source-project-form':projectSource,'reconcile-form':createReconciliation,'correction-form':addCorrection,
  'compare-form':compareEditions,'report-form':createReport,'export-form':exportDelivery,
  'unpack-form':unpackDelivery,'receive-form':receiveDelivery,
};
document.addEventListener('submit',event=>{
  const handler=submit[event.target.id];if(!handler)return;event.preventDefault();hideNotice();
  const button=event.submitter;if(button)button.disabled=true;
  Promise.resolve().then(handler).catch(showError).finally(()=>{if(button)button.disabled=false;});
});
document.addEventListener('click',event=>{
  const tabButton=event.target.closest('button[data-tab]');if(tabButton){tab(tabButton.dataset.tab);return;}
  const button=event.target.closest('button[data-action]');if(!button)return;
  button.disabled=true;Promise.resolve().then(()=>actionClick(button)).catch(showError).finally(()=>button.disabled=false);
});
document.addEventListener('input',event=>{
  const input=event.target;
  if(input.dataset.participant!==undefined){const row=participants[Number(input.dataset.participant)];if(row)row[input.dataset.field]=input.type==='checkbox'?input.checked:input.value;}
  if(input.dataset.contribution!==undefined){const row=contributions[Number(input.dataset.contribution)];if(row)row[input.dataset.field]=input.type==='checkbox'?input.checked:input.value;
    $('contribution-count').textContent=contributions.length+' contribution rows · '+contributions.filter(row=>row.approved).length+' approved';}
});
function click(id,handler){$(id).addEventListener('click',()=>Promise.resolve().then(handler).catch(showError));}
function change(id,handler){$(id).addEventListener('change',()=>Promise.resolve().then(handler).catch(showError));}
click('refresh',()=>refresh());click('policy-load',loadPolicy);click('batch-load',loadBatch);click('batch-save-plan',()=>saveBatch(true));
click('participant-add',()=>{participants.push({id:'participant-'+(participants.length+1),role:'driver',account:'',partnerId:'',label:'',memoType:'none',memoValue:'',weight:'1',retain:false});renderParticipants();});
click('contribution-add',()=>{contributions.push({id:'contribution-'+(contributions.length+1),participantId:'',units:'1',tier:'SCOUT1',approved:true});contributionOffset=Math.floor((contributions.length-1)/pageSize)*pageSize;renderContributions();});
change('participants-file',()=>importTable($('participants-file').files[0],'participants'));change('contributions-file',()=>importTable($('contributions-file').files[0],'contributions'));
click('contribution-prev',()=>{contributionOffset=Math.max(0,contributionOffset-pageSize);renderContributions();});
click('contribution-next',()=>{contributionOffset+=pageSize;renderContributions();});
change('capture-connection',configureCaptureKinds);change('capture-kind',configureCaptureFields);
$('source-search').addEventListener('input',()=>{sourceListOffset=0;renderSources();});
click('source-prev',()=>{sourceOffset=Math.max(0,sourceOffset-pageSize);renderSource();});click('source-next',()=>{sourceOffset+=pageSize;renderSource();});
click('source-download',()=>{if(selectedSource){const source=selectedSource.source;return download('/api/sources/'+encodeURIComponent(source.id)+'/original',source.request?.filename??'source-'+source.id+'.'+(source.provider==='document'?'bin':'json'));}});
click('sources-all',()=>all('#reconcile-sources input').forEach(input=>input.checked=true));click('sources-none',()=>all('#reconcile-sources input').forEach(input=>input.checked=false));
change('reconciliation-select',()=>loadReconciliation($('reconciliation-select').value));
$('leg-search').addEventListener('input',()=>{legOffset=0;renderReconciliation();});change('leg-status',()=>{legOffset=0;renderReconciliation();});
click('legs-prev',()=>{legOffset=Math.max(0,legOffset-pageSize);renderReconciliation();});click('legs-next',()=>{legOffset+=pageSize;renderReconciliation();});
change('correction-kind',()=>{$('correction-record-fields').hidden=$('correction-kind').value==='note';});
change('correction-source',()=>{const source=state.sources[$('correction-source').value];if(source){const form=$('correction-form');field(form,'provider').value=source.provider;field(form,'recordKind').value=source.kind;}});
change('correction-plan',async()=>{const choice=$('correction-plan').value;if(!choice)return;
  const plan=await read('edition.read',{kind:'plan',id:choice});select('correction-leg',plan.data.legs.map(row=>({id:row.id,label:row.phase+' / '+row.role+' / '+(row.participantId??'Treasury')})),{blank:'Select a settlement leg'});});
change('report-reconciliation',async()=>{const id=$('report-reconciliation').value;if(!id)return;const reconciliation=await read('edition.read',{kind:'reconciliation',id});
  const plan=await read('edition.read',{kind:'plan',id:reconciliation.planId});$('partner-options').innerHTML=[...new Set(plan.data.participants.map(row=>row.partnerId).filter(Boolean))].map(id=>'<option value="'+esc(id)+'"></option>').join('');});
change('export-kind',()=>{$('export-report').disabled=$('export-kind').value!=='report';});
click('history-refresh',()=>loadHistory());click('history-prev',()=>{historyOffset=Math.max(0,historyOffset-pageSize);return loadHistory();});
click('history-next',()=>{historyOffset=historyResult.nextOffset??historyOffset;return loadHistory();});
click('retry-request',async()=>{const original=pendingRequests.values().next().value;if(!original)return;const result=original.kind==='source'?await importOriginal(original.file,original.metadata,'Recovering the original source import'):await mutate(original.method,original.args,'Recovering the original request result');notify('Recovered the original operator result.'+(result.sourceId?' Source '+result.sourceId+'.':''));});
async function boot(){
  if(!token)throw error('Open the complete private workspace link printed by the operator.','WORKSPACE_LINK_REQUIRED');
  const result=await (await request('/api/bootstrap')).json();state=result.state;catalog=result.catalog;referencePolicy=result.referencePolicy;operatorInfo=result.operator;
  const form=$('profile-form');for(const name of ['name','organization','contact'])field(form,name).value=state.profile[name]??'';
  participants=[{id:'authority',role:'authority',account:'',partnerId:'',label:'Authority',memoType:'none',memoValue:'',weight:'1',retain:false},
    {id:'driver-pool',role:'driver_pool',account:'',partnerId:'',label:'Driver pool',memoType:'none',memoValue:'',weight:'1',retain:false},
    {id:'platform',role:'platform',account:'',partnerId:'',label:'Platform',memoType:'none',memoValue:'',weight:'1',retain:false}];
  $('policy-form').elements.namedItem('extra').value=pretty({provenance:referencePolicy.provenance});
  $('export-form').elements.namedItem('name').value=state.profile.name;$('export-report').disabled=true;
  render();renderConnections();renderParticipants();renderContributions();
  if($('reconciliation-select').value)await loadReconciliation($('reconciliation-select').value);
  setInterval(()=>{if(active&&document.visibilityState==='visible')refresh().catch(()=>{});},2000);
}
boot().catch(showError);
