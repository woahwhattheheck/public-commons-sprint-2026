/* MIT. Industrial local operator interface; original native actions remain authoritative. */
'use strict';
const $=(q,root=document)=>root.querySelector(q);
const $$=(q,root=document)=>[...root.querySelectorAll(q)];
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const pretty=value=>JSON.stringify(value,null,2);
const mono=value=>'<code>'+esc(value??'Not recorded')+'</code>';
const badge=(value,strong=false)=>'<span class="badge'+(strong?' strong':'')+'">'+esc(value??'Not recorded')+'</span>';
const money=value=>value===null||value===undefined?'Not recorded':String(value)+' atomic';
const date=value=>value?new Date(value).toLocaleString():'Not recorded';
const bytes=value=>Number.isSafeInteger(value)?new Intl.NumberFormat().format(value)+' bytes':'Not recorded';
const shell=value=>"'"+String(value).replace(/'/g,"'\\''")+"'";
const command=argv=>argv.map(shell).join(' ');
const uuid=()=>crypto.randomUUID();
const dl=pairs=>'<dl>'+pairs.map(([label,value,code=false])=>'<dt>'+esc(label)+'</dt><dd>'+(code?mono(value):esc(value??'Not recorded'))+'</dd>').join('')+'</dl>';
const jsonDetails=(title,value)=>'<details><summary>'+esc(title)+'</summary><pre>'+esc(pretty(value))+'</pre></details>';
const tokenKey='sf96-private-capability';
let token=sessionStorage.getItem(tokenKey)||'';
if(/^[a-f0-9]{64}$/.test(location.hash.slice(1))){
  token=location.hash.slice(1);sessionStorage.setItem(tokenKey,token);history.replaceState(null,'',location.pathname);
}
const state={status:null,view:'cases',case:null,caseTab:'overview',casePage:0,query:'',filter:'all',
  intakes:[],selectedIntake:null,prepareId:uuid(),intakeId:sessionStorage.getItem('sf96-intake-id')||uuid(),
  intakeKind:'capture',poll:null,uploads:[],uploadId:null,uploadFile:null,recoveryManifest:null,busy:false};
sessionStorage.setItem('sf96-intake-id',state.intakeId);
function notice(message,error=false) {
  $('#notice').innerHTML=message?'<div class="notice'+(error?' error':'')+'">'+esc(message)+'</div>':'';
}
function download(value){const a=document.createElement('a');a.href=value.url;a.download='';document.body.append(a);a.click();a.remove();}
async function api(path,{method='GET',value,raw}={}) {
  const headers={'X-Provider-Workspace-Token':token};
  if(value!==undefined)headers['Content-Type']='application/json';
  if(raw)headers['Content-Type']='application/octet-stream';
  const response=await fetch(path,{method,headers,body:raw??(value===undefined?undefined:JSON.stringify(value)),cache:'no-store'});
  let result;try{result=await response.json();}catch{throw new Error('The local workspace did not return a complete response. Reopen its saved state before repeating an action.');}
  if(!response.ok){const error=new Error(result.message??result.error??'The local operation could not complete.');Object.assign(error,result,{status:response.status});throw error;}
  return result;
}
function failure(error) {
  if(error.status===401)notice('Open the current capability URL from the workspace terminal. Restarting the server creates a new private URL.',true);
  else notice(error.message+(error.error?' ['+error.error+']':''),true);
  if(error.caseId)showDialog('Existing case','<p>This stable intent is already registered.</p><button data-open-case="'+esc(error.caseId)+'">Open original case</button>');
}
async function perform(button,callback) {
  if(button?.disabled)return;
  const text=button?.textContent;
  if(button){button.disabled=true;button.textContent='Working…';}
  try{return await callback();}catch(error){failure(error);}
  finally{if(button?.isConnected){button.disabled=false;button.textContent=text;}}
}
function showDialog(title,body){$('#dialog-content').innerHTML='<h2>'+esc(title)+'</h2>'+body;$('#dialog').showModal();}
function heading(kicker,title,description,actions='') {
  return '<div class="page-heading"><div><span class="eyebrow">'+esc(kicker)+'</span><h2>'+esc(title)+'</h2><p class="muted">'+esc(description)+'</p></div><div class="row">'+actions+'</div></div>';
}
function setView(view) {
  state.view=view;clearTimeout(state.poll);
  $$('.nav').forEach(button=>button.classList.toggle('active',button.dataset.view===view));
}
function route(view,caseId=null,tab=null,replace=false) {
  const hash=caseId?'case='+caseId+'&tab='+(tab??'overview'):'view='+view;
  history[replace?'replaceState':'pushState'](null,'','#'+hash);
}
async function navigate(view,{caseId=null,tab='overview',replace=false,quiet=false}={}) {
  if(!quiet)notice('');
  if(caseId){setView('cases');route('cases',caseId,tab,replace);state.caseTab=tab;return openCase(caseId);}
  setView(view);route(view,null,null,replace);
  if(view==='cases')return showCases();
  if(view==='intake')return showIntake();
  if(view==='recovery')return showRecovery();
  if(view==='setup')return showSetup();
}
async function showCases() {
  const data=await api('/api/cases?query='+encodeURIComponent(state.query)+'&state='+encodeURIComponent(state.filter)+'&page='+state.casePage);
  const count=Object.values(data.counts).reduce((a,b)=>a+b,0);
  $('#workspace').innerHTML=heading('Direct provider operations','Cases','Reopen the original source, queue, returned resource and accounting from one place.',
    '<button data-new-source>New source</button><button class="secondary" data-attach>Attach native case</button>')+
    '<div class="metrics">'+[['Retained cases',count],['Queued',data.counts.QUEUED??0],['Attempt recorded',(data.counts.ATTEMPT_RECORDED??0)+(data.counts.RECOVERED??0)],['Cancelled',data.counts.CANCELLED??0]]
      .map(([label,value])=>'<div class="metric"><strong>'+esc(value)+'</strong><span>'+label+'</span></div>').join('')+'</div>'+
    '<section class="panel"><form id="case-filter" class="toolbar"><label>Find a case<input name="query" value="'+esc(state.query)+'" placeholder="Provider, intent, resource or directory"></label>'+
    '<label class="compact">Original state<select name="state"><option value="all">All states</option>'+Object.keys(data.counts).sort().map(value=>'<option'+(state.filter===value?' selected':'')+'>'+esc(value)+'</option>').join('')+'</select></label>'+
    '<button type="submit" class="secondary">Apply</button><button type="button" class="secondary" data-refresh-cases>Refresh</button></form><hr class="divider">'+
    (data.cases.length?'<div class="table-wrap"><table><thead><tr><th>Case / provider</th><th>Native state</th><th>Source terms</th><th>Result / local review</th></tr></thead><tbody>'+
    data.cases.map(row=>'<tr><td><button class="list-button" data-open-case="'+esc(row.id)+'">'+esc(row.label)+'</button><span class="subline">'+esc(row.provider||row.intentId||row.directory)+'</span><span class="subline break">'+esc(row.resource??row.error??'')+'</span></td>'+
    '<td>'+badge(row.state)+'<span class="subline">'+esc(date(row.createdAt))+'</span></td><td>'+esc(row.network??'')+'<span class="subline">'+esc(money(row.amountAtomic))+'</span></td>'+
    '<td>'+esc(row.classification??row.buyerStatus??'No buyer outcome')+'<span class="subline">'+esc(row.fileStatus?'File: '+row.fileStatus:'No returned file')+'</span><span class="subline">'+esc(row.review?'Local review: '+row.review:'Local review not recorded')+'</span></td></tr>').join('')+
    '</tbody></table></div>':'<div class="empty"><h3>No matching cases</h3><p>Retain an actual source response or attach an existing original SF96 directory.</p></div>')+
    '<div class="pager"><span>'+esc(data.total)+' matching cases · page '+(data.page+1)+'</span><div class="row"><button class="secondary" data-page="'+(data.page-1)+'" '+(data.page===0?'disabled':'')+'>Previous</button><button class="secondary" data-page="'+(data.page+1)+'" '+((data.page+1)*data.pageSize>=data.total?'disabled':'')+'>Next</button></div></div></section>';
}
function attachDialog() {
  showDialog('Attach an existing native case','<p>Enter its original absolute directory. The desk verifies the saved SF96 handoff, workspace and inbox before registering it.</p>'+
    '<form id="attach-form"><label>Original case directory<input name="directory" required placeholder="/absolute/private/provider-case"></label><div class="actions"><button type="submit">Attach and reopen</button></div></form>');
}
function provenance(data) {
  const p=data.provenance??{};
  return dl([['Response URL',p.url,true],['Method',p.method],['HTTP status',p.status],['Acquisition',p.kind],
    ['Original collected time',p.collectedAtUtc===null?'Not recorded':p.collectedAtUtc],
    ['Imported time',p.importedAtUtc],['Method source',p.requestMethodSource],
    ['Capture SHA-256',data.captureSha256,true],['Header SHA-256',p.sourceHeaderSha256,true],['Original header bytes',p.sourceHeaderBytes]]);
}
function profileOptions(selected='') {
  return '<option value="">Select trusted host profile</option>'+state.status.profiles.map(p=>'<option value="'+esc(p.id)+'"'+(selected===p.id?' selected':'')+'>'+esc(p.label)+' · '+esc(p.payer.slice(0,9))+'…</option>').join('');
}
function intakeForm() {
  const kind=state.intakeKind;
  return '<section class="panel"><div class="panel-heading"><div><h3>Retain source material</h3><p class="help">The original SF85/SF84/SF96 admission reads the actual response and all offered payment alternatives.</p></div>'+badge(kind==='observe'?'ONE HTTP OBSERVATION':'OFFLINE IMPORT')+'</div>'+
    '<div class="tabs" role="tablist" aria-label="Source method">'+[['capture','Saved capture'],['headers','Response headers'],['observe','Observe endpoint']].map(([key,label])=>'<button type="button" data-intake-kind="'+key+'" class="'+(key===kind?'active':'')+'" role="tab" aria-selected="'+(key===kind)+'">'+label+'</button>').join('')+'</div>'+
    '<form id="intake-form" class="stack"><label>Source label<input name="label" maxlength="160" placeholder="Provider and useful resource"></label>'+
    (kind==='capture'?'<label>Original SF85 capture JSON<input name="capture" type="file" accept=".json,application/json" required><small>Original bytes are retained. Imported-header captures also require their exact source header file.</small></label><label>Original response headers, when present<input name="headers" type="file" accept=".headers,.txt,text/plain"></label>':
    (kind==='headers'?'<label>Original HTTP response header file<input name="headers" type="file" accept=".headers,.txt,text/plain" required><small>Import preserves the source header fingerprint and an unknown original collection time.</small></label>':'')+
    '<label>Actual resource URL<input name="url" type="url" required placeholder="https://provider.example/resource"></label>'+
    '<div class="grid two"><label>Explicit allowed origin<input name="allowOrigin" type="url" required placeholder="https://provider.example"><small>Exact HTTPS origin, separate from the requested path.</small></label><label>Original request method<select name="method"><option>GET</option><option>HEAD</option></select></label></div>'+
    (kind==='observe'?'<div class="grid two"><label>Host network profile<select name="profileId"><option value="">Direct public HTTPS</option>'+state.status.profiles.map(p=>'<option value="'+esc(p.id)+'">'+esc(p.label)+'</option>').join('')+'</select><small>Uses only the host’s configured network references.</small></label><label>Observation deadline, milliseconds<input name="timeoutMs" type="number" min="1000" max="30000" value="15000"></label></div><p class="help">This performs one original unauthenticated HTTPS observation. It does not sign or purchase. An interrupted observation stays visible and is never automatically repeated.</p>':''))+
    '<div class="actions"><button type="submit">'+(kind==='observe'?'Observe and retain once':'Import and retain')+'</button><button type="button" class="secondary" data-new-intake-id>Start a separate intake</button></div></form></section>';
}
function intakeList() {
  return '<section class="panel"><div class="panel-heading"><div><h3>Retained sources</h3><p class="help">Reopen the same imported bytes or completed observation.</p></div><button class="secondary" data-refresh-intakes>Refresh</button></div>'+
    (state.intakes.length?'<div class="table-wrap"><table><thead><tr><th>Source</th><th>Admission / provenance</th><th>Saved</th></tr></thead><tbody>'+state.intakes.map(item=>'<tr><td><button class="list-button" data-open-intake="'+esc(item.id)+'">'+esc(item.label||item.provenance?.url||item.id)+'</button><span class="subline break">'+esc(item.provenance?.url??item.kind)+'</span></td><td>'+badge(item.status)+'<span class="subline">'+esc(item.error??item.provenance?.kind??'')+'</span></td><td>'+esc(date(item.createdAt))+'</td></tr>').join('')+'</tbody></table></div>':'<div class="empty">No source material retained yet.</div>')+'</section>';
}
async function showIntake() {
  const result=await api('/api/intakes');state.intakes=result.intakes;
  $('#workspace').innerHTML=heading('Source and exact terms','Source intake','Choose an actual response and a locally declared spending cap before preparing a native case.','<button class="secondary" data-import-handoff>Import original handoff</button>')+
    intakeForm()+intakeList();
}
async function openIntake(id) {
  const data=await api('/api/intakes/'+id);state.selectedIntake=data;state.prepareId=uuid();
  const offers=data.report?.x402?.offer?.options??[];
  $('#workspace').innerHTML=heading('Retained source',data.label||'Source review','All alternatives come from these saved response bytes.',
    '<button class="secondary" data-view="intake">Back to intake</button>')+
    '<section class="panel"><div class="panel-heading"><h3>Original acquisition</h3>'+badge(data.status)+'</div>'+provenance(data)+
    (data.error?'<div class="callout">'+esc(data.error)+'</div>':'')+jsonDetails('Original intake inspection',data.report)+'</section>'+
    '<section class="panel"><h3>Payment alternatives</h3><p class="help">Select one exact Stellar offer. Unsupported alternatives remain visible with their original admission result.</p>'+
    (offers.length?offers.map(offer=>'<article class="offer" data-offer-box="'+offer.index+'"><div class="row"><label class="title"><input type="radio" name="offerIndex" value="'+offer.index+'" '+(!offer.eligible?'disabled':'')+'>Offer '+offer.index+' · '+esc(offer.scheme)+' · '+esc(offer.network)+'</label>'+badge(offer.eligible?'ELIGIBLE':offer.admissionError??'UNSUPPORTED')+'</div>'+
    dl([['Quoted amount',money(offer.amount)],['Asset',offer.asset,true],['Recipient',offer.payTo,true],['Maximum timeout',String(offer.maxTimeoutSeconds)+' seconds'],['Offer SHA-256',offer.originalOfferSha256,true]])+'</article>').join(''):
    '<div class="empty">The original inspection did not produce a payment alternative. Retained source bytes remain available for diagnosis.</div>')+'</section>'+
    '<section class="panel"><h3>Prepare the original operator case</h3>'+
    (!state.status.profiles.length?'<div class="callout">No host profile is configured. Use <button class="subtle" data-view="setup">Host setup</button> to add public operator settings and secret references in the trusted terminal, then restart the desk.</div>':'')+
    '<form id="prepare-form" class="stack"><div class="grid two"><label>Case label<input name="label" maxlength="160" required value="'+esc(data.label||'Provider resource')+'"></label><label>Provider<input name="provider" maxlength="160" placeholder="Provider or project"></label></div>'+
    '<div class="grid two"><label>Stable intent identifier<input name="intentId" required maxlength="128" pattern="[A-Za-z0-9._:-]{1,128}" value="provider:'+new Date().toISOString().slice(0,10).replaceAll('-','')+':'+uuid().slice(0,8)+'"><small>Keep this identifier for the same purchase. Existing registered intents reopen their original case.</small></label>'+
    '<label>Independent maximum amount, atomic<input name="maxAtomic" required inputmode="numeric" pattern="[1-9][0-9]*" placeholder="Enter the approved atomic cap"><small>The original selected quote must fit this locally entered limit.</small></label></div>'+
    '<label>Trusted host profile<select name="profileId" required>'+profileOptions()+'</select></label><div id="selected-profile" class="help"></div>'+
    '<label>Useful-output criteria<textarea name="criteria" maxlength="4000" placeholder="The resource and behavior this purchase should deliver; record provider-specific criteria explicitly."></textarea></label>'+
    '<div class="actions"><button type="submit" '+(!state.status.profiles.length?'disabled':'')+'>Prepare case and original inbox</button></div><p class="help">Preparation creates the original private SF88 workspace and one queued operation. Wallet loading and any payment occur only through the later native execution command.</p></form></section>';
  if(data.sourceHandoff) {
    const original=data.sourceHandoff,form=$('#prepare-form');
    form.elements.intentId.value=original.intentId;form.elements.intentId.readOnly=true;
    form.elements.maxAtomic.value=original.maxAtomic;form.elements.maxAtomic.readOnly=true;
    $$('input[name=offerIndex]').forEach(input=>{input.checked=Number(input.value)===original.offerIndex;input.disabled=true;});
    $('[data-offer-box="'+original.offerIndex+'"]')?.classList.add('selected');
    notice('The original verified handoff selection, stable intent and atomic cap are retained. Preparation consumes that same bundle.');
  }
}
async function file64(file,maximum) {
  if(!file||!file.size)throw new Error('Choose a nonempty original source file.');
  if(file.size>maximum)throw new Error('The source file exceeds the displayed native intake limit.');
  const array=new Uint8Array(await file.arrayBuffer());let binary='';
  for(let i=0;i<array.length;i+=8192)binary+=String.fromCharCode(...array.subarray(i,i+8192));
  return btoa(binary);
}
async function submitIntake(form,button) {
  const value={id:state.intakeId,kind:state.intakeKind,label:form.elements.label.value};
  if(state.intakeKind==='capture') {
    value.captureBase64=await file64(form.elements.capture.files[0],state.status.limits.captureBytes);
    if(form.elements.headers.files[0])value.headersBase64=await file64(form.elements.headers.files[0],state.status.limits.headerBytes);
  }else{
    value.url=form.elements.url.value;value.allowOrigin=form.elements.allowOrigin.value;value.method=form.elements.method.value;
    if(state.intakeKind==='headers')value.headersBase64=await file64(form.elements.headers.files[0],state.status.limits.headerBytes);
    else{value.timeoutMs=Number(form.elements.timeoutMs.value);if(form.elements.profileId.value)value.profileId=form.elements.profileId.value;}
  }
  const intake=await api('/api/intakes',{method:'POST',value});
  await openIntake(intake.id);
  notice(intake.status==='RETAINED'?'The original source is retained. Select its exact offer and local cap.':'The intake has a retained failure or interruption record. Read it before starting a separate observation.',intake.status!=='RETAINED');
}
async function submitPrepare(form) {
  const selected=$('input[name=offerIndex]:checked');
  if(!selected)throw new Error('Select an eligible original payment alternative.');
  const value={id:state.prepareId,intakeId:state.selectedIntake.id,offerIndex:Number(selected.value)};
  for(const key of ['profileId','intentId','maxAtomic','label','provider','criteria'])value[key]=form.elements[key].value;
  const result=await api('/api/cases',{method:'POST',value});
  await navigate('cases',{caseId:result.id});
  notice('The original case is prepared. Review its source and run native setup diagnostics before using the trusted terminal.');
}
function caseHeader(data) {
  const n=data.native,o=data.outcomes;
  return heading('Original provider case',data.context.label,'Intent '+n.intentId,
    '<button class="secondary" data-case-refresh>Refresh original state</button><button class="secondary" data-view="cases">All cases</button>')+
    '<div class="metrics"><div class="metric"><strong>'+esc(n.buyer.state)+'</strong><span>Original inbox state</span></div>'+
    '<div class="metric"><strong>'+esc(o.classification??o.buyer??'Not attempted')+'</strong><span>Original buyer / outcome classification</span></div>'+
    '<div class="metric"><strong>'+esc(o.responseFile?.status??'No file')+'</strong><span>Returned resource</span></div>'+
    '<div class="metric"><strong>'+esc(o.accounting?.outcome??o.accounting?.status??'Not finalized')+'</strong><span>Original accounting result</span></div></div>'+
    (data.lock?'<div class="callout"><strong>Case operation: '+esc(data.lock.action??data.lock.record?.action??'native owner')+'</strong> · '+esc(data.lock.state)+'<br>The owner record is shown in Recovery. The permanent native attempt is unchanged.</div>':'')+
    '<div class="tabs" role="tablist" aria-label="Case detail">'+[['overview','Source & outcome'],['operate','Native operations'],['review','Useful-output review'],['delivery','Handover & files'],['recovery','Case recovery']].map(([key,label])=>'<button data-case-tab="'+key+'" role="tab" aria-selected="'+(state.caseTab===key)+'" class="'+(state.caseTab===key?'active':'')+'">'+label+'</button>').join('')+'</div>';
}
function outcomePanel(data) {
  const o=data.outcomes;
  return '<section class="panel"><h3>Original outcome</h3>'+dl([
    ['Queue',o.queue],['Buyer result',o.buyer],['HTTP response',o.httpStatus],['Seller-reported settlement',o.sellerSettlement===null?'Not recorded':pretty(o.sellerSettlement)],
    ['SF52 classification',o.classification],['Independent transfer evidence',o.independentlyVerifiedTransfer===null?'Not recorded':pretty(o.independentlyVerifiedTransfer)],
    ['Response file',o.responseFile?.status],['Returned bytes',o.responseFile?.bytes],['File SHA-256',o.responseFile?.sha256,true],
    ['Accounting',o.accounting?pretty(o.accounting):'Not finalized'],['Accounting recorded',o.accountingAt]])+
    '<p class="help">An HTTP response, seller settlement statement, saved file, independently observed transfer and ledger finalization are separate original results.</p>'+
    (o.errors.length?jsonDetails('Native errors and cleanup observations',o.errors):'')+'</section>';
}
function overviewPanel(data) {
  const n=data.native,s=n.source;
  return '<div class="split"><div><section class="panel"><div class="panel-heading"><h3>Exact saved terms</h3>'+badge(s.network,true)+'</div>'+
    dl([['Resource',s.originalResourceUrl,true],['Method',s.originalMethod],['Quoted amount',money(s.quotedAtomic)],['Locally declared cap',money(s.maxAtomic)],
      ['Asset',s.asset,true],['Recipient',s.recipient,true],['Offer index',s.offerIndex],['Selected offer SHA-256',s.selectedOfferSha256,true]])+
    '</section>'+outcomePanel(data)+'</div><div><section class="panel"><h3>Source provenance</h3>'+dl([
    ['Acquisition',s.captureSource],['Collected time',s.capturedAt===null?'Not recorded':s.capturedAt],['Imported time',s.importedAt],['Method source',s.requestMethodSource],
    ['Capture SHA-256',s.captureSha256,true],['Original header SHA-256',s.sourceHeaderSha256,true]])+'</section>'+
    '<section class="panel"><h3>Native workspace</h3>'+dl([['Public payer',n.operator.payer,true],['Network',n.operator.network],['RPC origin',n.operator.rpcOrigin,true],
    ['Signer source',n.operator.signerSource],['Case directory',data.directory,true],['Observed',data.observedAt]])+
    '<p class="help">The host profile supplies public setup and trusted secret references. The browser never receives a wallet value.</p></section></div></div>'+
    jsonDetails('Full original reopened state',n);
}
function activityList(data) {
  return data.activities.length?'<ul class="timeline">'+data.activities.map(item=>'<li><div class="row spread"><h4>'+esc(item.action)+'</h4>'+badge(item.phase)+'</div>'+
    '<span class="stamp">'+esc(date(item.startedAt))+' · '+esc(item.id)+'</span>'+
    (item.error?'<p>'+esc(item.error)+'</p>':'')+
    (item.active&&['review','execute','finalize'].includes(item.action)?'<div class="actions"><button class="secondary" data-stop-action="'+esc(item.id)+'">Request original command stop</button></div>':'')+
    (item.result!==undefined?jsonDetails('Original action result',item.result):'')+'</li>').join('')+'</ul>':'<p class="muted">No desk actions have been requested for this case.</p>';
}
function nativeButton(data,action,label) {
  return '<button '+(['cancel','recover','finalize'].includes(action)?'class="secondary" ':'')+'data-native-action="'+action+'" '+(!data.controls[action]?'disabled':'')+'>'+label+'</button>';
}
function operatePanel(data) {
  return '<div class="split"><div><section class="panel"><h3>Review and execute</h3><p>The original command runs on the terminal that launched this desk. Keep it visible for native source review, setup errors and the unchanged typed spend approval.</p>'+
    '<div class="actions">'+nativeButton(data,'diagnose','Run setup diagnostics')+nativeButton(data,'review','Review in trusted terminal')+'</div>'+
    '<div class="callout">Starting execution opens the original SF88 operation. A browser click does not approve spending. Its configured wallet, policy, inbox and <code>/dev/tty</code> confirmation remain authoritative.</div>'+
    '<div class="actions">'+nativeButton(data,'execute','Run in trusted terminal')+'</div>'+
    '<hr class="divider"><h3>Continue the same native case</h3><p class="help">Recovery reads the original evidence and saved result. Finalization uses the original accounting mechanism. Cancellation is available only before the native attempt.</p>'+
    '<div class="actions">'+nativeButton(data,'recover','Recover original outcome')+nativeButton(data,'finalize','Finalize original accounting')+nativeButton(data,'cancel','Cancel unattempted case')+'</div>'+
    '<p class="help">Every action has a retained request identifier. A lost browser response does not cause automatic resubmission.</p></section>'+
    '<section class="panel"><h3>Original commands</h3><p class="help">These are the applicable command arrays from the current reopened original case.</p>'+
    Object.entries(data.commands).map(([name,entry])=>'<details><summary>'+esc(name)+'</summary><pre class="command">'+esc(entry.text)+'</pre><div class="actions"><button class="secondary" data-copy="'+esc(entry.text)+'">Copy command</button></div></details>').join('')+'</section></div>'+
    '<section class="panel"><div class="panel-heading"><h3>Retained desk activity</h3><button class="secondary" data-case-refresh>Refresh</button></div>'+activityList(data)+
    '<p class="help">This request history describes desk activity. The original inbox, ledger and evidence remain the source of payment state.</p></section></div>';
}
function reviewPanel(data) {
  const c=data.context,review=c.review,current=!review||review.nativeRevision===data.nativeFingerprint;
  return '<div class="split"><div><section class="panel"><h3>Useful-output criteria</h3><form id="context-form" class="stack"><div class="grid two"><label>Case label<input name="label" maxlength="160" required value="'+esc(c.label)+'"></label><label>Provider<input name="provider" maxlength="160" value="'+esc(c.provider)+'"></label></div>'+
    '<label>Criteria<textarea name="criteria" maxlength="4000">'+esc(c.criteria)+'</textarea></label><label>Named local operator<input name="operator" maxlength="160" required value="'+esc(sessionStorage.getItem('sf96-operator-name')||'')+'"></label><div class="actions"><button type="submit">Save case context</button></div></form></section>'+
    '<section class="panel"><h3>Record the useful-output review</h3><p class="help">This records the entered operator’s attestation about the exact native state. It does not assert customer acceptance or alter any payment result.</p>'+
    (review?'<div class="callout">'+badge(review.decision)+' · '+esc(review.operator)+' · '+esc(date(review.at))+'<br>'+esc(review.note||'No review note')+
    '<br>'+esc(current?'Bound to the current native state.':'The native state changed after this review; record a new review when ready.')+'</div>':'')+
    '<form id="review-form" class="stack"><label>Local decision<select name="decision"><option value="unreviewed">Not yet reviewed</option><option value="useful">Useful against entered criteria</option><option value="needs-work">Needs more work</option></select></label>'+
    '<label>Review note<textarea name="note" maxlength="4000" placeholder="What was examined, the useful outcome and any remaining issues."></textarea></label>'+
    '<label>Named local operator<input name="operator" maxlength="160" required value="'+esc(sessionStorage.getItem('sf96-operator-name')||'')+'"></label><div class="actions"><button type="submit">Record local review</button></div></form>'+
    (c.reviews?.length?jsonDetails('Retained local review history',c.reviews):'')+'</section></div>'+
    '<section class="panel"><h3>Private operating notes</h3><form id="note-form" class="stack"><label>Note<textarea name="note" required maxlength="4000"></textarea></label><label>Named local operator<input name="operator" required maxlength="160" value="'+esc(sessionStorage.getItem('sf96-operator-name')||'')+'"></label><div class="actions"><button type="submit">Append note</button></div></form><hr class="divider">'+
    (c.notes.length?'<ul class="timeline">'+[...c.notes].reverse().map(note=>'<li><h4>'+esc(note.operator)+'</h4><span class="stamp">'+esc(date(note.at))+'</span><p>'+esc(note.text)+'</p></li>').join('')+'</ul>':'<p class="muted">No private notes recorded.</p>')+'</section></div>';
}
function deliveryPanel(data) {
  return '<div class="split"><div><section class="panel"><h3>Original source and returned resource</h3>'+
    '<div class="file-row"><div><h4>Original capture</h4><p class="help">The exact SF85 JSON selected for this case.</p>'+mono(data.native.source.captureSha256)+'</div><button class="secondary" data-case-download="capture">Download capture</button></div>'+
    '<div class="file-row"><div><h4>Original response headers</h4><p class="help">'+(data.native.source.sourceHeaderSha256?'The exact imported source header file.':'No separate source header file was recorded.')+'</p>'+mono(data.native.source.sourceHeaderSha256)+'</div><button class="secondary" data-case-download="headers" '+(!data.native.source.sourceHeaderSha256?'disabled':'')+'>Download headers</button></div>'+
    '<div class="file-row"><div><h4>Returned resource</h4><p class="help">Availability follows the original response writer’s saved status and its exact byte fingerprint.</p>'+badge(data.outcomes.responseFile?.status??'NOT RECORDED')+'</div><button data-case-download="response" '+(!data.controls.downloadResponse?'disabled':'')+'>Download returned file</button></div></section>'+
    '<section class="panel"><h3>Private readable handover</h3><p>The original queue report is combined with saved useful-output criteria, named local review and operating notes. It opens as a standalone HTML file.</p>'+
    '<p class="help">It includes private provider and operator context. Review the file before sending it to another person. It contains no accounting keys and does not restore the native case.</p>'+
    '<div class="actions"><button data-case-report>Export private handover</button><button class="secondary" data-case-tab="recovery">Complete encrypted recovery</button></div></section></div>'+
    '<section class="panel"><h3>Retained exports</h3><p class="help">Re-download completed outputs without repeating the source observation or native operation.</p>'+exportList(data.exports)+'</section></div>';
}
function exportList(exports) {
  return exports.length?exports.map(item=>'<div class="file-row"><div><h4>'+esc(item.kind==='backup'?'Complete encrypted case':'Private readable handover')+'</h4><p class="help">'+esc(date(item.createdAt))+' · '+esc(bytes(item.bytes))+'</p>'+mono(item.sha256)+'</div>'+(item.status==='UNINDEXED_CIPHERTEXT'?'<button class="secondary" data-resume-backup="'+esc(item.id)+'">Verify retained archive</button>':'<button class="secondary" data-artifact="'+esc(item.id)+'">Download</button>')+'</div>').join(''):'<p class="muted">No desk exports retained yet.</p>';
}
function caseRecoveryPanel(data) {
  return '<div class="split"><div><section class="panel"><h3>Complete encrypted case</h3><p>Preserve the exact original source, native configuration, inbox, ledger, evidence, returned resource and saved case context together.</p>'+
    '<div class="callout">Recovery keeps the original absolute directory:<br>'+mono(data.directory)+'<br>On the recovery host, retain the required original source and provider references. Restore refuses an existing destination.</div>'+
    '<form id="backup-form" class="stack"><label>Recovery passphrase<input type="password" name="passphrase" minlength="12" autocomplete="new-password" required><small>At least 12 characters. It is used for this encryption request and is not saved by the desk.</small></label>'+
    '<label>Repeat passphrase<input type="password" name="repeat" minlength="12" autocomplete="new-password" required></label><div class="actions"><button type="submit" '+(!data.controls.backup?'disabled':'')+'>Create and download encrypted case</button></div></form>'+
    '<p class="help">The archive contains the case’s original accounting keys. Its manifest and file contents are encrypted and authenticated. Keep the passphrase separately. Native wallet environment values are not included.</p>'+
    '<details><summary>Native backup and restore commands</summary><pre class="command">'+esc(command(['node',state.status.source.deskCli,'backup','--dir',data.directory,'--out','/ABSOLUTE/NEW.sf96case']))+'</pre><pre class="command">'+esc(data.recovery.command)+'</pre></details></section>'+
    '<section class="panel"><h3>Restore or reopen</h3><p>Use the Recovery desk to inspect a complete encrypted file and its original destination. To reopen a present case, attach its directory directly.</p><div class="actions"><button class="secondary" data-view="recovery">Open Recovery desk</button><button class="secondary" data-attach>Attach existing case</button></div></section></div>'+
    '<div><section class="panel"><h3>Current native owner</h3>'+
    (data.lock?'<p>The original case coordinator has a retained owner record.</p>'+jsonDetails('Exact coordinator record',data.lock)+
    '<p class="help">An explicit stopped-owner release removes only this short-lived coordinator lease. It never removes, expires or resets a permanent SF88 attempt.</p>'+
    '<form id="clear-lock-form" class="stack"><label>Named local operator<input name="operator" required maxlength="160" value="'+esc(sessionStorage.getItem('sf96-operator-name')||'')+'"></label><button type="submit" class="secondary" '+(!data.controls.clearLock?'disabled':'')+'>Release the confirmed stopped owner</button></form>':
    '<p class="muted">No SF96 operation currently owns this case.</p>')+
    jsonDetails('Permanent original attempt, if recorded',data.native.buyer.attempt??null)+'</section>'+
    '<section class="panel"><h3>Retained exports</h3>'+exportList(data.exports)+'</section></div></div>';
}
function formDrafts() {
  return $$('form', $('#workspace')).map(form=>({id:form.id,values:[...form.elements].filter(e=>e.name&&e.type!=='file'&&e.type!=='password').map(e=>[e.name,e.value,e.checked])}));
}
function restoreDrafts(drafts) {
  for(const draft of drafts){const form=document.getElementById(draft.id);if(!form)continue;for(const[name,value,checked]of draft.values){const e=form.elements[name];if(e&&typeof e.value==='string'){e.value=value;if(e.type==='checkbox'||e.type==='radio')e.checked=checked;}}}
}
function renderCase(data,{preserve=false}={}) {
  const drafts=preserve?formDrafts():[];
  state.case=data;
  const panels={overview:overviewPanel,operate:operatePanel,review:reviewPanel,delivery:deliveryPanel,recovery:caseRecoveryPanel};
  if(!panels[state.caseTab])state.caseTab='overview';
  $('#workspace').innerHTML=caseHeader(data)+panels[state.caseTab](data);
  if(preserve)restoreDrafts(drafts);
}
async function openCase(id,{preserve=false}={}) {
  clearTimeout(state.poll);
  const data=await api('/api/cases/'+id);renderCase(data,{preserve});
  if(data.activities.some(item=>item.active))scheduleCase(id);
  return data;
}
function scheduleCase(id) {
  clearTimeout(state.poll);
  state.poll=setTimeout(async()=>{
    if(state.case?.id!==id||state.view!=='cases')return;
    try{await openCase(id,{preserve:true});}catch(error){failure(error);}
  },1500);
}
async function nativeAction(action) {
  const data=state.case,id=uuid();
  const record=await api('/api/cases/'+data.id+'/actions',{method:'POST',value:{id,action,expectedRevision:data.revision}});
  state.caseTab='operate';route('cases',data.id,'operate',true);await openCase(data.id);
  notice(['execute','review'].includes(action)?'The original command is running in the workspace terminal. Follow its native output there. Request '+record.id+'.':
    'The original '+action+' action is retained as '+record.id+'.');
}
async function saveContext(form,kind) {
  const data=state.case,operator=form.elements.operator.value;
  const value={expectedRevision:data.revision,operator};
  sessionStorage.setItem('sf96-operator-name',operator);
  if(kind==='context')for(const key of ['label','provider','criteria'])value[key]=form.elements[key].value;
  if(kind==='note')value.note=form.elements.note.value;
  if(kind==='review')value.review={decision:form.elements.decision.value,note:form.elements.note.value};
  await api('/api/cases/'+data.id+'/context',{method:'POST',value});
  if(kind==='note'&&form.elements.note.value===value.note)form.elements.note.value='';
  await openCase(data.id,{preserve:true});
  notice(kind==='review'?'The named local review is recorded against the original native state.':'The private case context is saved.');
}
function recoveryForm() {
  return '<section class="panel"><h3>Inspect a complete encrypted case</h3><p>Choose a new archive or an already retained encrypted upload. A passphrase error keeps the same upload available for an explicit retry.</p>'+
    '<form id="recovery-form" class="stack"><label>Complete .sf96case file<input name="archive" type="file" accept=".sf96case,application/octet-stream"></label>'+
    '<label>Or use retained encrypted upload<select name="uploadId"><option value="">Select a retained upload</option>'+state.uploads.map(item=>'<option value="'+esc(item.id)+'"'+(item.id===state.uploadId?' selected':'')+'>'+esc(date(item.createdAt))+' · '+esc(bytes(item.bytes))+' · '+esc(item.id.slice(0,8))+'</option>').join('')+'</select></label>'+
    '<label>Recovery passphrase<input name="passphrase" type="password" minlength="12" required autocomplete="off"><small>The passphrase is not persisted. Uploaded ciphertext remains private to this workspace.</small></label>'+
    '<div class="actions"><button type="submit">Verify and inspect archive</button><button type="button" class="secondary" data-refresh-uploads>Refresh retained uploads</button></div></form></section><div id="recovery-inspection"></div>';
}
async function showRecovery() {
  state.uploads=(await api('/api/uploads')).uploads;
  $('#workspace').innerHTML=heading('Complete native case','Recovery','Authenticate the complete archive, review its original bindings and restore the same case without rewriting its identity.',
    '<button class="secondary" data-attach>Reopen present case</button>')+recoveryForm();
}
function showRecoveryManifest(result) {
  state.recoveryManifest=result;
  const m=result.manifest;
  $('#recovery-inspection').innerHTML='<section class="panel"><div class="panel-heading"><h3>Verified archive</h3>'+badge('COMPLETE PRIVATE CASE',true)+'</div>'+
    dl([['Original destination',m.originalDirectory,true],['Stable intent',m.intentId,true],['Original state',m.state],
      ['Capture SHA-256',m.captureSha256,true],['Queue configuration SHA-256',m.queueConfigSha256,true],
      ['Archive created',m.createdAt],['Retained entries',result.files],['Uncompressed bytes',m.totalBytes],
      ['Original tree SHA-256',m.treeSha256,true]])+
    '<p class="help">The archive has passed authentication and every retained file fingerprint has been checked. Restore still requires the original directory to be absent and its source/runtime references available.</p>'+
    jsonDetails('Original source and runtime references',{sourceReferences:m.sourceReferences,runtime:m.runtime})+
    (result.interruption?'<div class="callout"><h4>Interrupted restore record</h4>'+esc(result.interruption.ownerStatus)+' · '+esc(result.interruption.phase)+'<p>The exact staging directory is retained below. A published case is preserved.</p>'+mono(result.interruption.stage)+jsonDetails('Saved restore owner',result.interruption)+'<div class="actions"><button class="secondary" data-retire-restore '+(!result.interruption.canRetire?'disabled':'')+'>Retire the confirmed stopped restore stage</button></div></div>':'')+
    (result.localRestoreAllowed?'<form id="restore-form" class="stack"><label>Exact original directory<input name="directory" readonly value="'+esc(m.originalDirectory)+'"></label><label>Recovery passphrase<input name="passphrase" type="password" minlength="12" required autocomplete="off"></label>'+
      '<div class="actions"><button type="submit">Restore the original case</button></div><p class="help">The existing destination is never overwritten. If this is the live case, reopen it instead.</p></form>':
      '<div class="callout">This original path is outside the managed case root. Use the command below on the trusted recovery host.</div>')+
    '<details><summary>Trusted terminal restore command</summary><pre class="command">'+esc(result.command)+'</pre><div class="actions"><button class="secondary" data-copy="'+esc(result.command)+'">Copy command</button></div></details></section>';
}
async function submitRecovery(form) {
  const file=form.elements.archive.files[0],selected=form.elements.uploadId.value;
  let id=selected||state.uploadId;
  if(file) {
    if(file!==state.uploadFile||!state.uploadId) {
      if(file.size>state.status.limits.recoveryBytes)throw new Error('The encrypted file exceeds this workspace’s complete recovery limit.');
      const upload=await api('/api/uploads',{method:'POST',raw:file});
      state.uploadFile=file;state.uploadId=upload.id;id=upload.id;
    }else id=state.uploadId;
  }
  if(!id)throw new Error('Choose a complete archive or an already retained encrypted upload.');
  state.uploadId=id;
  const result=await api('/api/uploads/inspect',{method:'POST',value:{id,passphrase:form.elements.passphrase.value}});
  form.elements.passphrase.value='';showRecoveryManifest(result);notice('The complete encrypted archive is verified. Its original destination and runtime references are shown.');
}
async function restoreCase(form) {
  const value={id:state.recoveryManifest.id,expectedDirectory:form.elements.directory.value,passphrase:form.elements.passphrase.value};
  const result=await api('/api/uploads/restore',{method:'POST',value});
  form.elements.passphrase.value='';await navigate('cases',{caseId:result.case.id,tab:'overview'});
  notice('The complete original case was restored and reopened at its exact native path. No operation was repeated.');
}
function showSetup() {
  const s=state.status,cli=s.source.deskCli;
  const example=command(['node',cli,'profile','--out','/ABSOLUTE/PRIVATE/host-profiles.json','--id','provider-operator',
    '--label','Provider operator','--actor','YOUR_OPERATOR','--service','YOUR_SERVICE','--payer','YOUR_PUBLIC_G_ADDRESS','--python','/usr/bin/python3','--secret-env','STELLAR_SECRET']);
  $('#workspace').innerHTML=heading('Trusted host setup','Operator profiles','Prepare the original host references in your terminal; select their public profile in the browser.')+
    '<section class="panel prose"><h3>1. Configure a public operator profile</h3><p>The profile command records the public payer, actor, service, Python executable and a host secret reference. It does not load the wallet or make a request.</p><pre class="command">'+esc(example)+'</pre>'+
    '<p class="help">Replace the uppercase values and absolute paths. Use <code>--signer-provider ABS_MODULE</code> instead of <code>--secret-env NAME</code> for an existing trusted native provider. The original network catalog supplies the matching default RPC. Optional named CONNECT proxy and native total/daily caps use the original workspace options.</p>'+
    '<h3>2. Launch with that profile file</h3><pre class="command">'+esc(command(['node',cli,'serve','--state',s.stateDirectory,'--profiles','/ABSOLUTE/PRIVATE/host-profiles.json','--port',String(location.port)]))+'</pre>'+
    '<p>Open the new capability URL printed by the server. The profile file is loaded at startup; restart the desk after an explicit profile change. Keep the original case directory and terminal.</p>'+
    '<h3>3. Prepare, review and operate the original case</h3><p>Import an actual source response, select one exact offered route, enter its independent cap and useful-output criteria, and prepare its native inbox. Run diagnostics and original review. Execution remains subject to the existing trusted-terminal approval and wallet/policy prerequisites.</p>'+
    '<h3>4. Keep a complete recovery point</h3><p>Export the encrypted case while original native writers are idle. Preserve the original source/provider references and restore to the same absolute directory on the recovery host. The readable handover is a separate private deliverable.</p>'+
    '<details><summary>All native host and recovery options</summary><pre class="command">'+esc(command(['node',cli,'help']))+'</pre></details></section>'+
    '<section class="panel"><h3>Current host</h3>'+dl([['Workspace directory',s.stateDirectory,true],['Profiles file',s.profileSource,true],
      ['Execution',s.execution],['Complete recovery',s.recovery],['Capture limit',bytes(s.limits.captureBytes)],['Header limit',bytes(s.limits.headerBytes)],
      ['Encrypted upload limit',bytes(s.limits.recoveryBytes)]])+'</section>'+
    '<section class="panel"><h3>Loaded public profiles</h3>'+(s.profiles.length?s.profiles.map(p=>'<article class="offer"><h4>'+esc(p.label)+' · '+esc(p.id)+'</h4>'+dl([['Public payer',p.payer,true],['Actor',p.actor],['Service',p.service],
      ['Python',p.python,true],['Signer reference',p.signer],['Wallet environment name',p.walletEnvironmentName],['RPC',p.rpc,true],
      ['Network transport',p.proxy],['Case total cap',money(p.totalAtomic)],['Case daily cap',money(p.dailyAtomic)],['Returned file limit',bytes(p.maxResponseBytes)]])+'</article>').join(''):'<p class="muted">No profiles loaded. Existing native cases can still be attached, reviewed and recovered.</p>')+'</section>';
}
document.addEventListener('click',event=>{
  const button=event.target.closest('button');if(!button)return;
  if(button.classList.contains('dialog-close')){$('#dialog').close();return;}
  if(button.dataset.view){perform(button,()=>navigate(button.dataset.view));return;}
  if(button.hasAttribute('data-import-handoff')){
    showDialog('Import an original verified handoff','<p>Choose the existing private SF96 handoff directory. Its original capture, header bytes, selected offer, stable intent and cap are verified and retained together.</p>'+
      '<form id="handoff-intake-form" data-id="'+uuid()+'"><div class="stack"><label>Label<input name="label" maxlength="160"></label><label>Original handoff directory<input name="directory" required placeholder="/absolute/private/verified-handoff"></label></div><div class="actions"><button type="submit">Verify and retain original handoff</button></div></form>');return;
  }
  if(button.hasAttribute('data-new-source')){state.selectedIntake=null;perform(button,()=>navigate('intake'));return;}
  if(button.hasAttribute('data-attach')){attachDialog();return;}
  if(button.dataset.openCase){$('#dialog').open&&$('#dialog').close();perform(button,()=>navigate('cases',{caseId:button.dataset.openCase}));return;}
  if(button.hasAttribute('data-refresh-cases')){perform(button,showCases);return;}
  if(button.dataset.page!==undefined){state.casePage=Number(button.dataset.page);perform(button,showCases);return;}
  if(button.dataset.intakeKind){state.intakeKind=button.dataset.intakeKind;perform(button,showIntake);return;}
  if(button.hasAttribute('data-new-intake-id')){state.intakeId=uuid();sessionStorage.setItem('sf96-intake-id',state.intakeId);notice('A separate intake identifier is ready. Enter the source for this explicit new import or observation.');return;}
  if(button.hasAttribute('data-refresh-intakes')){perform(button,showIntake);return;}
  if(button.dataset.openIntake){perform(button,()=>openIntake(button.dataset.openIntake));return;}
  if(button.dataset.caseTab){state.caseTab=button.dataset.caseTab;route('cases',state.case.id,state.caseTab,true);renderCase(state.case);return;}
  if(button.hasAttribute('data-case-refresh')){perform(button,()=>openCase(state.case.id,{preserve:true}));return;}
  if(button.dataset.nativeAction){perform(button,()=>nativeAction(button.dataset.nativeAction));return;}
  if(button.dataset.stopAction){perform(button,async()=>{
    await api('/api/cases/'+state.case.id+'/stop',{method:'POST',value:{id:button.dataset.stopAction}});
    await openCase(state.case.id);notice('Stop was requested from the original command. Reopen its retained outcome before any further action.');});return;}
  if(button.dataset.caseDownload){perform(button,async()=>download(await api('/api/cases/'+state.case.id+'/download',{method:'POST',value:{kind:button.dataset.caseDownload,expectedRevision:state.case.revision}})));return;}
  if(button.hasAttribute('data-case-report')){perform(button,async()=>{
    const saved=await api('/api/cases/'+state.case.id+'/report',{method:'POST',value:{expectedRevision:state.case.revision}});
    download(saved.download);await openCase(state.case.id);notice('The private original handover is retained and downloaded.');});return;}
  if(button.dataset.resumeBackup){
    showDialog('Verify the retained encrypted case','<p>The ciphertext committed before its export index. Enter its passphrase to verify the exact original case and complete only the missing index.</p>'+
      '<form id="resume-backup-form" data-artifact="'+esc(button.dataset.resumeBackup)+'"><label>Recovery passphrase<input name="passphrase" type="password" minlength="12" required autocomplete="off"></label><div class="actions"><button type="submit">Verify and complete retained export</button></div></form>');return;
  }
  if(button.hasAttribute('data-retire-restore')){
    perform(button,async()=>{
      const m=state.recoveryManifest;
      await api('/api/uploads/retire-restore',{method:'POST',value:{directory:m.manifest.originalDirectory,intentSha256:m.interruption.sha256}});
      state.recoveryManifest={...m,interruption:null};showRecoveryManifest(state.recoveryManifest);
      notice('The stopped restore stage is retired. Any published original case and permanent native attempt are preserved.');
    });return;
  }
  if(button.dataset.artifact){perform(button,async()=>download(await api('/api/artifacts/download',{method:'POST',value:{id:button.dataset.artifact}})));return;}
  if(button.hasAttribute('data-refresh-uploads')){perform(button,showRecovery);return;}
  if(button.dataset.copy){perform(button,async()=>{await navigator.clipboard.writeText(button.dataset.copy);notice('The exact native command is copied.');});return;}
});
document.addEventListener('submit',event=>{
  const form=event.target;if(!(form instanceof HTMLFormElement))return;event.preventDefault();
  const button=event.submitter??$('button[type=submit]',form);
  perform(button,async()=>{
    if(form.id==='case-filter'){state.query=form.elements.query.value;state.filter=form.elements.state.value;state.casePage=0;return showCases();}
    if(form.id==='attach-form'){const result=await api('/api/cases/attach',{method:'POST',value:{directory:form.elements.directory.value}});$('#dialog').close();return navigate('cases',{caseId:result.id});}
    if(form.id==='handoff-intake-form'){
      const saved=await api('/api/intakes',{method:'POST',value:{id:form.dataset.id,kind:'handoff',label:form.elements.label.value,directory:form.elements.directory.value}});
      $('#dialog').close();return openIntake(saved.id);
    }
    if(form.id==='intake-form')return submitIntake(form,button);
    if(form.id==='prepare-form')return submitPrepare(form);
    if(form.id==='context-form')return saveContext(form,'context');
    if(form.id==='note-form')return saveContext(form,'note');
    if(form.id==='review-form')return saveContext(form,'review');
    if(form.id==='resume-backup-form') {
      const match=form.dataset.artifact.match(/-([a-f0-9-]{36})\.sf96case$/);
      if(!match)throw new Error('The saved archive identifier is invalid.');
      const saved=await api('/api/cases/'+state.case.id+'/backup',{method:'POST',value:{id:match[1],expectedRevision:state.case.revision,passphrase:form.elements.passphrase.value}});
      form.reset();$('#dialog').close();download(saved.download);await openCase(state.case.id);
      notice('The existing ciphertext was verified and its export index completed. No operation or encryption was repeated.');return;
    }
    if(form.id==='backup-form') {
      if(form.elements.passphrase.value!==form.elements.repeat.value)throw new Error('The recovery passphrases do not match.');
      form.dataset.requestId??=uuid();
      const value={id:form.dataset.requestId,expectedRevision:state.case.revision,passphrase:form.elements.passphrase.value};
      const saved=await api('/api/cases/'+state.case.id+'/backup',{method:'POST',value});
      form.reset();download(saved.download);await openCase(state.case.id);notice('The complete encrypted case is retained and downloaded.');return;
    }
    if(form.id==='clear-lock-form'){
      await api('/api/cases/'+state.case.id+'/clear-lock',{method:'POST',value:{expectedRevision:state.case.revision,lockSha256:state.case.lock.sha256,operator:form.elements.operator.value}});
      await openCase(state.case.id);notice('Only the confirmed stopped coordinator owner was released. The original native attempt remains.');return;
    }
    if(form.id==='recovery-form')return submitRecovery(form);
    if(form.id==='restore-form')return restoreCase(form);
  });
});
document.addEventListener('change',event=>{
  if(event.target.name==='offerIndex')$$('[data-offer-box]').forEach(e=>e.classList.toggle('selected',e.dataset.offerBox===event.target.value));
  if(event.target.name==='profileId'&&event.target.closest('#prepare-form')) {
    const p=state.status.profiles.find(p=>p.id===event.target.value);
    $('#selected-profile').textContent=p?p.actor+' · '+p.service+' · '+p.payer:'';
  }
  if(event.target.name==='archive'&&event.target.closest('#recovery-form')){
    state.uploadId=null;state.uploadFile=null;state.recoveryManifest=null;$('#recovery-inspection').innerHTML='';
    event.target.form.elements.uploadId.value='';
  }
  if(event.target.name==='uploadId'&&event.target.closest('#recovery-form')){
    state.uploadId=event.target.value||null;state.uploadFile=null;state.recoveryManifest=null;event.target.form.elements.archive.value='';
    $('#recovery-inspection').innerHTML='';
  }
});
function adoptCapability(fragment) {
  const next=fragment.replace(/^#/,'');
  if(!/^[a-f0-9]{64}$/.test(next))return false;
  token=next;sessionStorage.setItem(tokenKey,token);history.replaceState(null,'',location.pathname);
  clearTimeout(state.poll);return true;
}
window.addEventListener('popstate',()=>{
  // Consume a new terminal capability before ordinary routing can rewrite the
  // hash. A same-document navigation dispatches popstate before hashchange.
  if(adoptCapability(location.hash))connect();
  else loadRoute().catch(failure);
});
async function loadRoute() {
  const params=new URLSearchParams(location.hash.slice(1));
  if(/^[a-f0-9]{32}$/.test(params.get('case')??''))return navigate('cases',{caseId:params.get('case'),tab:params.get('tab')??'overview',replace:true});
  const view=['cases','intake','recovery','setup'].includes(params.get('view'))?params.get('view'):'cases';
  return navigate(view,{replace:true});
}
async function connect() {
  try{state.status=await api('/api/status');$('#connection').textContent='Private host connected';await loadRoute();}
  catch(error){$('#connection').textContent='Open terminal URL';failure(error);}
}
window.addEventListener('hashchange',event=>{
  const fragment=new URL(event.newURL).hash;
  if(fragment.slice(1)!==token&&adoptCapability(fragment))connect();
});
connect();
