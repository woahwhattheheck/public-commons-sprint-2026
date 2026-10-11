/* MIT. Wallet views use the original private resource session and native APIs. */
'use strict';
const $ = id => document.getElementById(id);
const node = (tag,text,className) => {const value=document.createElement(tag);if(text!==undefined)value.textContent=String(text);if(className)value.className=className;return value;};
const asText = value => value === null || value === undefined ? '—' : String(value);
const json = value => JSON.stringify(value,null,2);
const state = {context:null,job:null,review:null,data:null,offset:0,q:'',selectionVersion:0,comparisonVersion:0,
  comparison:{left:null,right:null,result:null},annotation:null,noteDraft:null,busy:false};
const fragment = location.hash.slice(1);
let token = /^[a-f0-9]{64}$/.test(fragment) ? fragment : sessionStorage.getItem('goldrush-private-session');
if (fragment && token === fragment) {
  sessionStorage.setItem('goldrush-private-session',token);
  history.replaceState(null,'',location.pathname+location.search);
}
$('library-link').href = '/#' + (token ?? '');
function notice(message,error=false) {$('notice').textContent=message;$('notice').classList.toggle('error',error);}
function key(name) {return 'goldrush:'+(state.context?.id ?? '')+':'+name;}
function saved(name) {try{return JSON.parse(localStorage.getItem(key(name)));}catch{return null;}}
function retain(name,value) {try{value===null?localStorage.removeItem(key(name)):localStorage.setItem(key(name),JSON.stringify(value));}catch{notice('Browser draft storage is full. Saved requests and notes remain in the workspace.',true);}}
async function request(path,{method='GET',body,raw=false}={}) {
  const response = await fetch(path,{method,headers:{Authorization:'Bearer '+token,
    ...(body === undefined ? {} : {'Content-Type':'application/json'})},
    ...(body === undefined ? {} : {body:JSON.stringify(body)}),cache:'no-store',signal:AbortSignal.timeout(115000)});
  if (!response.ok) {
    let failure;try{failure=await response.json();}catch{failure={};}
    throw Object.assign(new Error(failure.error ?? 'HTTP_'+response.status),{code:failure.error,status:response.status});
  }
  return raw ? response : response.json();
}
const api = (name,options) => request('/api/goldrush/'+name,options);
function friendly(error) {
  const code=error.code ?? error.message;
  const known={
    PRIVATE_SESSION_REQUIRED:'Reopen the private URL printed by this workspace process.',
    GOLDRUSH_PREPARED_OPERATOR_REQUIRED:'This saved request is an offline preparation. Open an execution workspace with your original operator profile and prepare its configured request.',
GOLDRUSH_SCHEMA_RUNTIME_REQUIRED:'This installation is missing required schema validation support. Use the schema installation in the workspace guide, then reopen.',
    GOLDRUSH_RELEASE_CHANGED_REFRESH:'The provider release changed. Refresh and review its current terms before preparing.',
    INTENT_ALREADY_EXISTS_USE_RECOVER:'This request ID already exists. Select it in saved requests and recover its result.',
    GOLDRUSH_INTENT_REQUEST_CONFLICT:'This ID belongs to a different request. Clear the form to begin a new request.',
    GOLDRUSH_EXISTING_INTENT_DIFFERS:'This ID is already used by a different saved native request.',
    ANNOTATION_REVISION_CONFLICT:'The saved note changed. Your draft is kept. Read the saved revisions and use the latest revision before saving.',
    ORIGINAL_OPERATOR_CONFIGURATION_REQUIRED:'The existing operator configuration is required to execute this request.',
    ORIGINAL_INTENT_ACTION_RUNNING:'An action for this request is already running. Refresh its saved state before continuing.',
    GOLDRUSH_SUCCESSFUL_SAVED_RESPONSE_REQUIRED:'This request does not yet have a complete successful saved response.',
    GOLDRUSH_COMPLETE_JSON_REQUIRED:'The saved response must contain the complete provider JSON.',
    GOLDRUSH_OBSERVATION_BYTES_CHANGED:'This observation file changed. Restore the exact retained file or supply its current source manifest.'
  };
  return known[code] ?? (error.name === 'TimeoutError' || error.name === 'AbortError'
    ? 'The browser wait ended. Select the same request and recover its saved result before starting another action.'
    : 'The operation returned '+code+'. Saved work is retained.');
}
async function task(button,message,run) {
  if (state.busy) return;
  state.busy=true;if(button)button.disabled=true;updateControls();notice(message);
  try {await run();}catch(error){notice(friendly(error),true);}
  finally {state.busy=false;if(button)button.disabled=false;updateControls();}
}
function facts(element,entries,metrics=false) {
  element.replaceChildren();
  for (const [label,value] of entries) {
    const dt=node('dt',label),dd=node('dd',asText(value));
    if(metrics){const div=node('div');div.append(dt,dd);element.append(div);}else element.append(dt,dd);
  }
}
function optionList(element,values,selected) {
  element.replaceChildren(...values.map(value=>{const option=node('option',value.label??value);option.value=value.value??value;return option;}));
  if(values.some(value=>(value.value??value)===selected))element.value=selected;
}
function operationSpec() {return state.context?.release.operations.find(row=>row.id==='goldrush-'+$('operation').value);}
function formPolicy(resetAmount=false) {
  const op=operationSpec();if(!op)return;
  const schema=op.offer.extensions?.bazaar?.schema?.properties?.input?.properties;
  const chains=schema?.pathParams?.properties?.chainName?.enum ?? [];
  const quotes=schema?.queryParams?.properties?.['quote-currency']?.enum ?? [];
  optionList($('chain'),chains,$('chain').value);
  optionList($('quote'),quotes,$('quote').value || 'USD');
  const accepts=op.offer.accepts ?? [];
  optionList($('accept'),accepts.map((a,i)=>({value:String(i),label:(i+1)+'. '+a.amount+' atomic · '+a.network})),$('accept').value);
  const transfers=$('operation').value==='transfers';
  $('transfer-fields').hidden=!transfers;$('spam-field').hidden=transfers;$('contract').required=transfers;
  const pageMax=schema?.queryParams?.properties?.['page-size']?.maximum ?? 100;
  $('page-size').max=String(pageMax);
  if(Number($('page-size').value)>pageMax)$('page-size').value=String(pageMax);
  paymentTerms(resetAmount);
}
function paymentTerms(resetAmount=false) {
  const accept=operationSpec()?.offer.accepts?.[Number($('accept').value)];
  $('payment-terms').textContent=accept ? 'Asset '+accept.asset+' · Recipient '+accept.payTo : 'No payment option is available in this release.';
  if(accept && (resetAmount || !$('max-atomic').value))$('max-atomic').value=accept.amount;
}
const formFields=['operation','chain','wallet','quote','no-spam','contract','page','page-size','accept','max-atomic','intent','payment-flow'];
function saveForm() {if(state.context)retain('request-draft',Object.fromEntries(formFields.map(name=>[name,$(name).value])));}
function restoreForm() {
  const draft=saved('request-draft');
  if(draft){if(draft.operation)$('operation').value=draft.operation;formPolicy();for(const name of formFields)if(typeof draft[name]==='string')$(name).value=draft[name];formPolicy();}
  if(!$('intent').value)$('intent').value='goldrush-'+crypto.randomUUID();
  saveForm();
}
function inputFromForm() {
  const query={'quote-currency':$('quote').value};
  if($('operation').value==='balances')query['no-spam']=$('no-spam').value;
  else Object.assign(query,{'contract-address':$('contract').value,'page-number':$('page').value,'page-size':$('page-size').value});
  return {operation:$('operation').value,chain:$('chain').value,wallet:$('wallet').value,
    query,intentId:$('intent').value,acceptIndex:Number($('accept').value),maxAtomic:$('max-atomic').value,
    ...($('payment-flow').value ? {paymentFlow:$('payment-flow').value} : {}),
    releaseSha256:state.context.release.sha256};
}
function setFormFromSnapshot(data) {
  const snap=data.snapshot;
  $('operation').value=snap.operation;formPolicy();
  $('chain').value=snap.chain;$('wallet').value=snap.address;$('quote').value=snap.quoteCurrency ?? snap.query['quote-currency'] ?? 'USD';
  if(snap.operation==='transfers') {
    $('contract').value=snap.query['contract-address'] ?? '';
    $('page').value=String(snap.pagination.nextPage);
    $('page-size').value=String(snap.pagination.pageSize);
  } else $('no-spam').value=String(snap.query['no-spam'] ?? 'true');
  $('payment-flow').value=data.job?.expect?.paymentFlow ?? '';
  if(data.job?.expect) {
    const match=(operationSpec()?.offer.accepts ?? []).findIndex(a=>['scheme','network','asset','payTo'].every(k=>a[k]===data.job.expect[k]));
    if(match>=0)$('accept').value=String(match);
    $('max-atomic').value=data.job.expect.maxAtomic;
  }
  $('intent').value='goldrush-'+crypto.randomUUID();paymentTerms();saveForm();
  $('request-heading').scrollIntoView({block:'start'});$('max-atomic').focus();
  notice('The next page is in the request form. Review its terms, then prepare it.');
}
async function refreshContext({scan=false,first=false}={}) {
  if(scan)await api('refresh',{method:'POST',body:{}});
  const value=await api('context?offset='+state.offset+'&q='+encodeURIComponent(state.q));
  state.context=value;
  $('workspace-label').textContent='Workspace '+value.id.slice(0,8);
  facts($('release-details'),[['Service',value.release.manifest.publicOrigin],
    ['Created',value.release.manifest.createdAt],['Release SHA-256',value.release.sha256]]);
  formPolicy();if(first)restoreForm();
  renderHistory();renderObservations();
  if(state.job){const updated=value.jobs.items.find(job=>job.intentId===state.job.intentId);if(updated)state.job=updated;renderJob();}
  if(first) {
    const comparison=saved('comparison');
    if(comparison){state.comparison.left=comparison.left??null;state.comparison.right=comparison.right??null;renderComparisonSlots();}
    const id=value.library.selection;
    if(id)try{await openData({kind:'buyer',id});}catch(error){notice(friendly(error),true);}
  }
  updateControls();
}
function renderHistory() {
  const jobs=state.context.jobs;
  $('history-count').textContent=jobs.total+' total';
  $('history-page').textContent=jobs.total ? (jobs.offset+1)+'–'+Math.min(jobs.offset+jobs.limit,jobs.total) : 'No saved requests';
  $('newer').disabled=jobs.offset===0;$('older').disabled=jobs.offset+jobs.limit>=jobs.total;
  const rows=jobs.items.map(job=>{
    const button=node('button',undefined,'request-item'+(state.job?.intentId===job.intentId?' selected':''));
    button.type='button';
    const text=node('span');text.append(node('strong',job.intentId),node('small',
      (job.scope?.operation??'Request')+' · '+(job.scope?.chain??'')+' · '+(job.createdAt??'Unknown time')));
    button.append(text,node('span',job.state,'badge'));
    button.addEventListener('click',()=>task(button,'Opening saved request…',async()=>{await selectJob(job);notice('Saved request opened.');}));
    return button;
  });
  $('request-list').replaceChildren(...(rows.length?rows:[node('p','Prepared and completed requests will appear here.','muted')]));
}
async function selectJob(job) {
  state.job=job;state.review=null;renderHistory();renderJob();
  const response=job.resources?.find(row=>row.status==='VERIFIED');
  if(response)await openData({kind:'buyer',id:response.id});
  else clearData();
}
function renderJob() {
  $('request-detail').hidden=!state.job;if(!state.job)return;
  const job=state.job;$('selected-intent').textContent=job.intentId;$('selected-state').textContent=job.state;
  $('request-url').textContent=(job.method??'GET')+' '+job.url;
  const expect=job.expect??{};
  facts($('review-facts'),[['Network',expect.network],['Maximum atomic amount',expect.maxAtomic],
    ['Asset',expect.asset],['Recipient',expect.payTo],['Request owner',job.source==='node'?'Original Node preparation':'Original Inbox'],
    ['Saved outcome',job.outcome?.status??'No outcome recorded'],
    ['Response',job.outcome?.deliveryStatus??'Not delivered']]);
  $('review-json').textContent=state.review?json(state.review):'Review this saved request to see its original operator review.';
  $('finalize').hidden=!state.context.workspaceConfigured;updateControls();
}
function updateControls() {
  if(state.context){$('newer').disabled=state.busy || state.context.jobs.offset===0;$('older').disabled=state.busy || state.context.jobs.offset+state.context.jobs.limit>=state.context.jobs.total;}
  $('prepare').disabled=state.busy || !state.context;
  $('execute').disabled=state.busy || !state.review || state.job?.source!=='inbox' || Boolean(state.job?.outcome);
  $('review').disabled=state.busy || !state.job;$('recover').disabled=state.busy || !state.job;
  $('finalize').disabled=state.busy || !state.job?.outcome;
  $('compare').disabled=state.busy || !state.comparison.left || !state.comparison.right;
  const editable=Boolean(state.data?.resource);
  $('save-note').disabled=state.busy || !editable;
  $('comparison-note').disabled=state.busy || !editable || !state.comparison.result;
  for(const id of ['compare-left','compare-right','next-page'])$(id).disabled=state.busy || !state.data;
  for(const id of ['clear-request','clear-comparison','use-latest-note'])$(id).disabled=state.busy;
}
function clearData() {
  state.selectionVersion++;state.data=null;state.annotation=null;state.noteDraft=null;
  $('data-empty').hidden=false;$('data-view').hidden=true;$('source-kind').hidden=true;
  renderNotes();updateControls();
}
async function openData(selection) {
  const version=++state.selectionVersion;
  const value=await api('response?kind='+encodeURIComponent(selection.kind)+'&id='+encodeURIComponent(selection.id));
  if(version!==state.selectionVersion)return;
  state.data=value;
  if(value.resource)await request('/api/selection',{method:'PUT',body:{id:value.resource.id}});
  $('data-empty').hidden=true;$('data-view').hidden=false;$('source-kind').hidden=false;
  $('source-kind').textContent=selection.kind==='buyer'?'Saved request response':'Source observation';
  $('wallet-address').textContent=value.snapshot.address;
  const snap=value.snapshot;
  facts($('snapshot-facts'),[['Chain',snap.chain],['Updated',snap.updatedAt],['Rows',snap.rows.length],['Quote currency',snap.quoteCurrency]],true);
  const page=snap.pagination;
  const detail=snap.operation==='transfers' && page
    ? 'Transfer page '+page.pageNumber+' · requested size '+page.pageSize+'. '+(page.hasMore?'The provider advertises more pages.':'The provider advertises no further page for this request.')
    : 'Balances returned for this wallet and the exact filters below.';
  const scope=typeof snap.coverage==='string'?snap.coverage:snap.coverage.interpretation;
  const unscaled=snap.coverage?.unscaledRows?.length ?? 0,ambiguous=snap.coverage?.ambiguousKeys?.length ?? 0;
  $('coverage').textContent=detail+' '+scope+(unscaled?' '+unscaled+' rows have no token decimal precision; their atomic quantities are retained.':'')+
    (ambiguous?' '+ambiguous+' duplicate row identities prevent comparison.':'');
  $('source-json').textContent=json({source:snap.source,query:snap.query,coverage:snap.coverage,
    pagination:snap.pagination,resource:value.resource});
  $('row-search').value='';renderRows();
  $('next-page').hidden=!(value.resource && snap.operation==='transfers' && page?.hasMore && page.nextPage!==null);
  $('download-raw').hidden=!value.resource;
  state.annotation=value.annotation;state.noteDraft=value.resource?saved('note:'+value.resource.id):null;
  renderNotes();await renderRevisions();updateControls();
}
function shortTime(value) {return typeof value==='string'?value.replace('T',' ').replace('Z',' UTC'):'—';}
function cell(primary,secondary,{quantity=false}={}) {
  const td=node('td',undefined,quantity?'quantity':undefined);td.append(node('strong',asText(primary)));
  if(secondary!==undefined && secondary!==null)td.append(node('small',secondary));
  return td;
}
function renderRows() {
  const snap=state.data?.snapshot;if(!snap)return;
  const q=$('row-search').value.trim().toLowerCase();
  const rows=snap.rows.filter(row=>!q||Object.values(row).some(v=>typeof v==='string'&&v.toLowerCase().includes(q)));
  const headers=snap.operation==='balances'
    ? ['Token','Balance','24h balance','Value · '+asText(snap.quoteCurrency)]
    : ['Time / transaction','Token','Direction','Amount','From / to'];
  const head=node('tr');headers.forEach(h=>head.append(node('th',h)));$('data-table').tHead.replaceChildren(head);
  $('data-table').tBodies[0].replaceChildren(...rows.map(row=>{
    const tr=node('tr');
    if(snap.operation==='balances')tr.append(
      cell(row.symbol??row.name,row.contractAddress),
      cell(row.amount,row.balance===null?'Quantity unavailable':'Atomic '+row.balance,{quantity:true}),
      cell(row.amount24h,null,{quantity:true}),cell(row.quote,null,{quantity:true}));
    else tr.append(cell(shortTime(row.blockSignedAt),row.txHash),cell(row.symbol??row.name,row.contractAddress),
      cell(row.direction,row.transferType),cell(row.amount,row.delta===null?null:'Atomic '+row.delta,{quantity:true}),
      cell(row.from,row.to));
    return tr;
  }));
  if(!rows.length){const tr=node('tr'),td=node('td',snap.rows.length?'No rows match this filter.':'The provider returned no transfer/token rows in this response.');td.colSpan=headers.length;tr.append(td);$('data-table').tBodies[0].append(tr);}
  $('row-count').textContent=rows.length+' of '+snap.rows.length+' rows. Quantities and values are shown without rounding.';
  const transactions=snap.transactions ?? [];
  $('transaction-detail').hidden=snap.operation!=='transfers';
  $('transaction-count').textContent='Containing transactions · '+transactions.length;
  $('transaction-table').replaceChildren();
  if(transactions.length) {
    const table=node('table'),thead=node('thead'),tr=node('tr');['Transaction','Value','Fees','Gas / result'].forEach(s=>tr.append(node('th',s)));thead.append(tr);table.append(thead);
    const body=node('tbody');
    for(const tx of transactions){const row=node('tr');row.append(cell(tx.txHash,shortTime(tx.blockSignedAt)),
      cell(tx.valueAmount,'Atomic '+asText(tx.value),{quantity:true}),
      cell(tx.feesAmount,(tx.gasSymbol??'')+' · atomic '+asText(tx.feesPaid),{quantity:true}),
      cell(asText(tx.gasSpent),tx.successful===null?'Result unavailable':tx.successful?'Successful':'Failed'));body.append(row);}
    table.append(body);$('transaction-table').append(table);
  }
}
function renderNotes() {
  const resource=state.data?.resource, annotation=state.annotation;
  const value=state.noteDraft ?? annotation ?? {note:'',tags:[],starred:false};
  for(const name of ['note','tags','starred'])$(name).disabled=!resource;
  $('note').value=value.note??'';$('tags').value=(value.tags??[]).join(', ');$('starred').checked=value.starred===true;
  $('notes-context').textContent=resource?'Response '+resource.intentId:'Select a saved request response to retain notes in its original resource library.';
  $('note-state').textContent=resource?'Saved revision '+annotation.revision+(state.noteDraft?' · browser draft retained':''):'';
  $('use-latest-note').hidden=!(resource && state.noteDraft && state.noteDraft.expectedRevision!==annotation.revision);
  if(!resource)$('note-revisions').replaceChildren();updateControls();
}
function draftNote() {
  if(!state.data?.resource)return;
  const value={expectedRevision:state.noteDraft?.expectedRevision ?? state.annotation.revision,
    note:$('note').value,tags:$('tags').value.split(',').map(s=>s.trim()).filter(Boolean),starred:$('starred').checked};
  const previous=state.noteDraft;
  if(previous && ['expectedRevision','note','starred'].every(k=>previous[k]===value[k]) && json(previous.tags)===json(value.tags))
    value.operationId=previous.operationId;
  else value.operationId='goldrush-note-'+crypto.randomUUID();
  state.noteDraft=value;retain('note:'+state.data.resource.id,value);
  $('note-state').textContent='Saved revision '+state.annotation.revision+' · browser draft retained';
  return value;
}
async function renderRevisions() {
  const id=state.data?.resource?.id;if(!id)return;
  const revisions=await request('/api/resources/'+id+'/revisions');
  if(state.data?.resource?.id!==id)return;
  $('note-revisions').replaceChildren(...revisions.map(value=>{
    const div=node('div',undefined,'revision');div.append(node('strong','Revision '+value.revision),
      node('p',value.updatedAt,'muted fine'),node('pre',value.note||'(Empty note)'));return div;
  }));
  if(!revisions.length)$('note-revisions').append(node('p','No notes saved yet.','muted fine'));
}
function renderObservations() {
  $('observations').replaceChildren(...state.context.observations.map(row=>{
    const button=node('button');button.type='button';button.append(node('strong',row.operation+' · '+row.chain),
      node('div',row.source.operator,'muted'),node('div',row.source.retrievedAt,'muted fine'));
    button.addEventListener('click',()=>task(button,'Opening retained source observation…',async()=>{await openData({kind:'reference',id:row.id});notice('Source observation opened.');}));
    return button;
  }));
  if(!state.context.observations.length)$('observations').append(node('p',state.context.observationsError
    ? 'The attached observations returned '+state.context.observationsError+'. Saved requests remain available.'
    : 'No separate source observations are attached.','muted fine'));
}
function comparisonLabel(value) {return value ? value.label : 'No response selected';}
function renderComparisonSlots() {
  $('comparison-a').textContent=comparisonLabel(state.comparison.left);$('comparison-b').textContent=comparisonLabel(state.comparison.right);
  $('comparison-result').hidden=!state.comparison.result;
  retain('comparison',{left:state.comparison.left,right:state.comparison.right});updateControls();
}
function selectComparison(side) {
  const value=state.data;if(state.busy || !value)return;
  state.comparisonVersion++;
  state.comparison[side]={selection:value.selection,label:value.snapshot.operation+' · '+value.snapshot.chain+' · '+value.snapshot.updatedAt+' · '+value.snapshot.source.id};
  state.comparison.result=null;renderComparisonSlots();notice('Response selected as comparison '+(side==='left'?'A':'B')+'.');
}
function renderComparison() {
  const value=state.comparison.result;$('comparison-result').hidden=!value;
  if(!value)return;
  $('comparison-json').textContent=json(value);$('comparison-table').replaceChildren();
  $('comparison-status').textContent=value.comparable
    ? value.changes.length+' row changes · '+value.transactionChanges.length+' transaction changes · '+value.chronology+'. '+value.interpretation
    : 'These responses have different scope: '+value.reasons.join(', ')+'.';
  if(value.comparable && value.changes.length) {
    const table=node('table'),head=node('thead'),hr=node('tr');
    ['Token / row','Change','Amount change','Value change'].forEach(t=>hr.append(node('th',t)));head.append(hr);table.append(head);
    const body=node('tbody');
    value.changes.forEach(change=>{const tr=node('tr');tr.append(cell(change.symbol??change.name??change.key,change.contractAddress),
      cell(change.kind,change.changedFields.join(', ')),cell(change.amountDelta,change.unitMismatch?'Units differ':null,{quantity:true}),
      cell(change.quoteDelta,null,{quantity:true}));body.append(tr);});table.append(body);$('comparison-table').append(table);
  }
  updateControls();
}
async function download(response,name) {
  const blob=await response.blob(),url=URL.createObjectURL(blob),a=node('a');a.href=url;a.download=name;
  document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);
}
function downloadObject(value,name) {
  const url=URL.createObjectURL(new Blob([json(value)+'\n'],{type:'application/json'})),a=node('a');
  a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);
}
function listen(id,event,run) {$(id).addEventListener(event,run);}
listen('request-form','submit',event=>{event.preventDefault();void task($('prepare'),'Preparing the original request and offline review…',async()=>{
  saveForm();const result=await api('prepare',{method:'POST',body:inputFromForm()});
  state.job=result.job;state.review=result.review;state.offset=0;await refreshContext();renderJob();notice('Request prepared. Its original review is ready.');
});});
listen('clear-request','click',()=>{ $('request-form').reset();$('intent').value='goldrush-'+crypto.randomUUID();formPolicy(true);saveForm();notice('New request form ready. Saved requests remain in history.');});
listen('request-form','input',saveForm);
listen('operation','change',()=>{formPolicy(true);saveForm();});
listen('accept','change',()=>{paymentTerms(true);saveForm();});
listen('refresh','click',()=>task($('refresh'),'Refreshing original saved work…',async()=>{await refreshContext({scan:true});notice('Saved work refreshed.');}));
listen('history-form','submit',event=>{event.preventDefault();if(state.busy)return;state.q=$('history-search').value;state.offset=0;void task(null,'Finding saved requests…',async()=>{await refreshContext();notice('Saved request search complete.');});});
for(const [id,direction] of [['newer',-1],['older',1]])listen(id,'click',()=>task($(id),'Opening request history…',async()=>{state.offset=Math.max(0,state.offset+direction*50);await refreshContext();notice('Request history opened.');}));
for(const action of ['review','execute','recover','finalize'])listen(action,'click',()=>task($(action),action==='execute'?'Executing the reviewed request…':'Reading the original '+action+' result…',async()=>{
  const body={intentId:state.job.intentId,...(action==='execute'?{review:state.review}:{})};
  const result=await api(action,{method:'POST',body});
  state.job=result.job;state.review=result.review??null;
  await refreshContext({scan:action!=='review'});renderJob();
  if(action!=='review') {
    const refreshed=state.context.jobs.items.find(job=>job.intentId===state.job.intentId);
    if(refreshed?.resources?.some(row=>row.status==='VERIFIED'))await openData({kind:'buyer',id:refreshed.resources.find(row=>row.status==='VERIFIED').id});
  }
  notice(action==='review'?'Original review opened.':'Original '+action+' state saved: '+state.job.state+'.');
}));
listen('row-search','input',renderRows);
listen('next-page','click',()=>setFormFromSnapshot(state.data));
for(const format of ['json','csv'])listen('export-'+format,'click',()=>task($('export-'+format),'Preparing exact response export…',async()=>{
  const selection=state.data.selection,response=await api('export?kind='+encodeURIComponent(selection.kind)+'&id='+encodeURIComponent(selection.id)+'&format='+format,{raw:true});
  await download(response,'goldrush-'+state.data.snapshot.operation+'.'+format);notice('Response export downloaded.');
}));
listen('download-raw','click',()=>task($('download-raw'),'Opening the original verified download…',async()=>{
  const value=await request('/api/resources/'+state.data.resource.id+'/download',{method:'POST',body:{}});
  const a=node('a');a.href=value.url;a.download='';document.body.append(a);a.click();a.remove();notice('Original response download started.');
}));
for(const side of ['left','right'])listen('compare-'+side,'click',()=>selectComparison(side));
listen('clear-comparison','click',()=>{if(state.busy)return;state.comparisonVersion++;state.comparison={left:null,right:null,result:null};renderComparisonSlots();});
listen('compare','click',()=>task($('compare'),'Comparing the exact retained responses…',async()=>{
  const version=state.comparisonVersion;
  const result=await api('compare',{method:'POST',body:{left:state.comparison.left.selection,right:state.comparison.right.selection}});
  if(version!==state.comparisonVersion)return;
  state.comparison.result=result;renderComparison();notice(state.comparison.result.comparable?'Comparison ready.':'Comparison scope differences are shown.');
}));
listen('comparison-export','click',()=>downloadObject(state.comparison.result,'goldrush-comparison.json'));
listen('comparison-note','click',()=>{
  const value=state.comparison.result;if(state.busy || !value || !state.data?.resource)return;
  const summary='Comparison A '+value.leftSource.id+' ('+value.leftSource.sha256+') to B '+value.rightSource.id+' ('+value.rightSource.sha256+').\n'+
    (value.comparable?value.changes.length+' row changes; '+value.transactionChanges.length+' transaction changes. '+value.interpretation:'Scope differs: '+value.reasons.join(', '));
  $('note').value=($('note').value?$('note').value+'\n\n':'')+summary;draftNote();notice('Comparison summary added to the draft. Save the note to retain a revision.');
});
for(const id of ['note','tags','starred'])listen(id,'input',draftNote);
listen('note-form','submit',event=>{event.preventDefault();void task($('save-note'),'Saving a note revision…',async()=>{
  const id=state.data.resource.id,payload=draftNote();
  for(const name of ['note','tags','starred'])$(name).disabled=true;
  try {
    const annotation=await request('/api/resources/'+id+'/note',{method:'PATCH',body:payload});
    retain('note:'+id,null);state.noteDraft=null;state.annotation=annotation;renderNotes();await renderRevisions();notice('Note saved as revision '+annotation.revision+'.');
  } catch(error) {
    if(error.code==='ANNOTATION_REVISION_CONFLICT') {
      const current=await request('/api/resources/'+id);state.annotation=current.annotation;renderNotes();await renderRevisions();
    }
    throw error;
  } finally {renderNotes();}
});});
listen('use-latest-note','click',()=>{
  if(state.busy || !state.noteDraft)return;state.noteDraft.expectedRevision=state.annotation.revision;
  state.noteDraft.operationId='goldrush-note-'+crypto.randomUUID();retain('note:'+state.data.resource.id,state.noteDraft);
  renderNotes();notice('Draft now uses saved revision '+state.annotation.revision+'. Save when the note is ready.');
});
if(!token)notice('Open the private workspace URL printed by the running process.',true);
else void task(null,'Opening saved wallet work…',async()=>{await refreshContext({first:true});notice('Workspace ready. Preparation and saved analysis are available.');});
