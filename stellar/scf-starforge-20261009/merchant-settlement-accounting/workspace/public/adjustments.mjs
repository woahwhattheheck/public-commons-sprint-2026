// MIT. Original gross payments, adjustment requests and retained reverse transfers.
const $=id=>document.getElementById(id);
const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const exact=value=>value===null||value===undefined?'Not recorded':typeof value==='object'?JSON.stringify(value,null,2):String(value);
const date=value=>{
  if(!value)return 'Not recorded';
  const parsed=new Date(value);return Number.isFinite(parsed.getTime())?parsed.toISOString().replace('T',' ').replace('Z',' UTC'):String(value);
};
const short=value=>typeof value==='string'&&value.length>28?value.slice(0,16)+'…'+value.slice(-8):exact(value);
const encode=encodeURIComponent;
const PAGE=50;
const title=value=>({REFUND:'Refund request',CANCELLATION:'Cancellation',RECORDED:'Recorded',REQUESTED:'Requested',VERIFYING:'Verification running',VERIFIED:'Verified return',WITHDRAWN:'Withdrawn',QUEUED:'Queued',RUNNING:'Verifying transfer',COMPLETED:'Completed',FAILED:'Failed',INTERRUPTED:'Interrupted'}[value]??String(value??''));
const values=items=>'<dl class="record-values">'+items.map(([label,value])=>'<dt>'+esc(label)+'</dt><dd>'+esc(exact(value))+'</dd>').join('')+'</dl>';
const metrics=items=>items.map(([label,value])=>'<div class="metric"><span>'+esc(label)+'</span><strong class="exact">'+esc(exact(value))+'</strong></div>').join('');
const nonzero=value=>value!==undefined&&value!==null&&value!=='0';
const activeJob=job=>['QUEUED','RUNNING'].includes(job.status);
function choose(element,items,empty,preferred=element.value){
  const html=items.map(([value,label])=>'<option value="'+esc(value)+'">'+esc(label)+'</option>').join('')||'<option value="">'+esc(empty)+'</option>';
  if(element.innerHTML!==html)element.innerHTML=html;
  element.value=items.some(([value])=>value===preferred)?preferred:items[0]?.[0]??'';
}
function summaryStatus(totals={}){
  const labels=[];
  if(totals.refundStatus==='OVER_RETURNED')labels.push('Return exceeds original amount');
  else if(nonzero(totals.refundedAmountAtomic))labels.push(totals.remainingAmountAtomic==='0'?'Fully returned':'Partly returned');
  if(nonzero(totals.pendingRefundAmountAtomic))labels.push('Refund requested');
  if(nonzero(totals.cancelledAmountAtomic))labels.push('Cancellation recorded');
  return labels.join(' · ')||'Original gross retained';
}
function utc(value){
  if(!value)throw new Error('Enter the effective date and time in UTC.');
  const parsed=new Date(value+'Z');
  if(!Number.isFinite(parsed.getTime())||parsed.toISOString().slice(0,value.length)!==value)throw new Error('Enter a valid effective date and time in UTC.');
  return parsed.toISOString();
}

export async function mountAdjustments({api,perform,operator,attempt,notify,adopt,openArea,loadRun}){
  const fragment=await fetch('/adjustments.html',{cache:'no-store'});
  if(!fragment.ok)throw new Error('The adjustment workspace view could not be loaded.');
  $('area-adjustments').innerHTML=await fragment.text();
  let state=null,busy=false,localBusy=false,visible=false,runId='',eventId='',detail=null;
  let events={items:[],total:0,offset:0,limit:PAGE},eventToken=0,detailToken=0,previewToken=0,loadedRevision=-1;
  let preview=null,previewForm='',historyOffset=0,historyId='',lastRevision=-1,jobDetail=null,jobToken=0;
  const drafts=new Map();
  const retained=()=>detail?.adjustments??[];
  const jobs=()=>state?.adjustments?.jobs??[];
  const sourceKey=()=>runId+':'+eventId;
  const record=id=>retained().find(item=>item.id===id);
  function fields(){
    return {kind:$('adjustment-kind').value,amountAtomic:$('adjustment-amount').value,
      effectiveAt:$('adjustment-effective').value,reason:$('adjustment-reason').value,reference:$('adjustment-reference').value};
  }
  function fingerprint(){
    return JSON.stringify({runId,eventId,...fields(),actor:$('operator').value.trim()});
  }
  function saveDraft(){if(eventId)drafts.set(sourceKey(),fields());}
  function restoreDraft(){
    const draft=drafts.get(sourceKey())??{kind:'REFUND',amountAtomic:detail?.totals.availableRefundAmountAtomic??'',
      effectiveAt:new Date().toISOString().slice(0,19),reason:'',reference:''};
    for(const [field,id] of Object.entries({kind:'adjustment-kind',amountAtomic:'adjustment-amount',effectiveAt:'adjustment-effective',reason:'adjustment-reason',reference:'adjustment-reference'}))$(id).value=draft[field];
  }
  function clearPreview(){
    ++previewToken;preview=null;previewForm='';$('adjustment-preview-panel').hidden=true;controls();
  }
  function canRetain(){
    return preview&&preview.workspaceRevision===state?.revision&&previewForm===fingerprint();
  }
  function selectedRequest(){
    return record($('adjustment-verification-request').value);
  }
  function controls(){
    const blocked=busy||localBusy||!state,selected=Boolean(detail&&eventId),request=selectedRequest();
    $('adjustment-refresh').disabled=blocked||!runId;
    $('adjustment-run').disabled=blocked;
    $('adjustment-preview').disabled=blocked||!selected||($('adjustment-kind').value==='REFUND'&&(!detail.refundTerms||detail.totals.availableRefundAmountAtomic==='0'));
    $('adjustment-retain').disabled=blocked||!canRetain();
    $('adjustment-clear-preview').disabled=blocked;
    $('adjustment-verify').disabled=blocked||!request||request.status!=='REQUESTED'||!request.refundTerms;
    $('adjustment-verification-request').disabled=blocked;
    for(const input of $('adjustment-action-form').querySelectorAll('input,select,textarea'))input.disabled=blocked||!selected;
    for(const input of $('adjustment-verification-form').querySelectorAll('input,textarea'))input.disabled=blocked||!request||request.status!=='REQUESTED'||!request.refundTerms;
    for(const button of document.querySelectorAll('[data-adjustment-event],[data-adjustment-history],[data-adjustment-job]'))button.disabled=blocked;
    $('adjustment-withdraw').disabled=blocked||!$('adjustment-withdraw-request').value;
    $('adjustment-withdraw-request').disabled=blocked;
    $('adjustment-withdraw-reason').disabled=blocked||!$('adjustment-withdraw-request').value;
    $('adjustment-export').disabled=blocked||!runId;
    $('adjustment-previous').disabled=blocked||events.offset===0;
    $('adjustment-next').disabled=blocked||events.offset+events.items.length>=events.total;
    const count=retained().length;
    $('adjustment-history-previous').disabled=blocked||historyOffset===0;
    $('adjustment-history-next').disabled=blocked||historyOffset+PAGE>=count;
    for(const button of document.querySelectorAll('[data-adjustment-retry]'))button.disabled=blocked;
    $('adjustment-amount-hint').textContent=!detail?'':$('adjustment-kind').value==='REFUND'
      ?detail.refundTerms?'Available for a new request: '+detail.totals.availableRefundAmountAtomic+' atomic units.':'Capture this original payment with its matched SF86 transfer proof to create a refund request.'
      :'Original gross: '+detail.totals.grossAmountAtomic+' atomic units. Already cancelled: '+detail.totals.cancelledAmountAtomic+' atomic units.';
  }
  function renderEvents(){
    $('adjustment-events').innerHTML=events.items.map(item=>{
      const total=item.adjustmentSummary??{};
      return '<tr'+(item.eventId===eventId?' class="selected"':'')+'><td><button type="button" class="inspect" data-adjustment-event="'+esc(item.eventId)+'" aria-pressed="'+(item.eventId===eventId)+'">'+esc(item.method+' '+item.routeId)+'</button><span class="subtle">'+esc(item.network)+'</span><span class="subtle mono" title="'+esc(item.eventId)+'">'+esc(short(item.eventId))+'</span></td><td class="exact">'+esc(total.grossAmountAtomic??item.amountAtomic)+'</td><td class="exact">'+esc(total.refundedAmountAtomic??'0')+'</td><td>'+esc(summaryStatus(total))+'</td></tr>';
    }).join('')||'<tr><td colspan="4" class="empty">'+(runId?'No original events match this filter.':'Choose a completed reconciliation.')+'</td></tr>';
    $('adjustment-event-page').textContent=events.total?(events.offset+1)+'–'+Math.min(events.offset+events.items.length,events.total)+' of '+events.total+' original events':'0 events';
    controls();
  }
  function renderHistoryDetail(){
    const selected=record(historyId),target=$('adjustment-history-detail');target.hidden=!selected;
    if(!selected){target.innerHTML='';return;}
    const timeline=(selected.history??[]).map(entry=>'<li>'+values(Object.entries(entry).map(([key,value])=>[key.replace(/([a-z])([A-Z])/g,'$1 $2'),value]))+'</li>').join('');
    target.innerHTML='<h3>'+esc(title(selected.kind))+' · '+esc(title(selected.status))+'</h3>'+values([
      ['Adjustment ID',selected.id],['Original event',selected.eventId],['Amount · atomic',selected.amountAtomic],
      ['Effective at',date(selected.effectiveAt)],['Recorded at',date(selected.createdAt)],['Operator',selected.actor],
      ['Reason',selected.reason],['Reference',selected.reference||'Not provided']
    ])+(selected.verification?'<h3>Verified return</h3>'+values([
      ['Transaction',selected.verification.transaction],['Transfer at',date(selected.verification.transferAt)],
      ['Verified at',date(selected.verification.verifiedAt)],['Ledger',selected.verification.ledger],['Verification SHA-256',selected.verification.sha256]
    ])+'<details><summary>Original verification result</summary><pre>'+esc(JSON.stringify(selected.verification.proof,null,2))+'</pre></details>':'')+
      (timeline?'<h3>Saved actions</h3><ol class="adjustment-timeline">'+timeline+'</ol>':'');
  }
  function renderHistory(){
    const all=retained();
    historyOffset=Math.min(historyOffset,Math.max(0,Math.floor((all.length-1)/PAGE)*PAGE));
    $('adjustment-history').innerHTML=all.slice(historyOffset,historyOffset+PAGE).map(item=>'<tr'+(historyId===item.id?' class="selected"':'')+'><td>'+esc(date(item.effectiveAt))+'<span class="subtle">Recorded '+esc(date(item.createdAt))+'</span></td><td><button type="button" class="inspect" data-adjustment-history="'+esc(item.id)+'">'+esc(title(item.kind))+'</button><span class="subtle">'+esc(title(item.status))+'</span></td><td class="exact">'+esc(item.amountAtomic)+'</td><td>'+esc(item.reason)+'<span class="subtle">'+esc(item.actor)+(item.reference?' · '+esc(item.reference):'')+'</span></td><td>'+(item.verification?'<span class="mono" title="'+esc(item.verification.transaction)+'">'+esc(short(item.verification.transaction))+'</span><span class="subtle">'+esc(date(item.verification.transferAt))+'</span>':'')+'</td></tr>').join('')||'<tr><td colspan="5" class="empty">This event has no saved adjustments.</td></tr>';
    $('adjustment-history-page').textContent=all.length?(historyOffset+1)+'–'+Math.min(historyOffset+PAGE,all.length)+' of '+all.length+' adjustments':'0 adjustments';
    const eligible=all.filter(item=>item.kind==='REFUND'&&['REQUESTED','VERIFYING'].includes(item.status));
    const choices=eligible.map(item=>[item.id,item.amountAtomic+' atomic · '+date(item.effectiveAt)+' · '+title(item.status)]);
    const previousRequest=$('adjustment-verification-request').value;
    choose($('adjustment-verification-request'),choices,'No open refund requests');
    if(previousRequest!==$('adjustment-verification-request').value){$('adjustment-transaction').value='';$('adjustment-rpc').value='';}
    choose($('adjustment-withdraw-request'),eligible.filter(item=>item.status==='REQUESTED').map(item=>[item.id,item.amountAtomic+' atomic · '+date(item.effectiveAt)]),'No requests awaiting verification');
    renderHistoryDetail();renderVerification();controls();
  }
  function renderVerification(){
    const request=selectedRequest(),target=$('adjustment-verification-context'),terms=request?.refundTerms??detail?.refundTerms;
    target.innerHTML=request?values([
      ['Requested amount · atomic',request.amountAtomic],['Effective at',date(request.effectiveAt)],['Reason',request.reason],
      ['Network',terms?.network],['Asset',terms?.asset],['Return from',terms?.from],['Return to',terms?.to]
    ])+(request.refundTerms?'':'<p>Select an original payment with eligible retained transfer verification to check a return.</p>'):
      '<p>Save a refund request, then select it here to verify its returned transfer.</p>';
    const ownJobs=jobs().filter(job=>retained().some(item=>item.id===job.adjustmentId));
    const running=ownJobs.filter(activeJob);
    $('adjustment-verification-progress').hidden=!running.length;
    $('adjustment-verification-progress-text').textContent=running.length+' saved verification '+(running.length===1?'request is':'requests are')+' in progress.';
    $('adjustment-jobs').innerHTML=ownJobs.map(job=>{
      const item=record(job.adjustmentId),canRetry=['FAILED','INTERRUPTED'].includes(job.status)&&item?.status==='REQUESTED';
      return '<tr><td>'+esc(date(job.createdAt))+'<span class="subtle">'+esc(job.actor)+'</span></td><td class="exact">'+esc(item?.amountAtomic??'Not recorded')+'</td><td>'+esc(title(job.status))+'<span class="subtle">'+esc(job.completedAt?date(job.completedAt):'')+'</span></td><td><span class="mono" title="'+esc(job.transaction)+'">'+esc(short(job.transaction))+'</span>'+(job.error?'<span class="subtle">'+esc(job.error.message??job.error)+'</span>':'')+'<div class="actions"><button type="button" data-adjustment-job="'+esc(job.id)+'">Open attempt</button>'+(canRetry?'<button type="button" data-adjustment-retry="'+esc(job.id)+'">Load saved request</button>':'')+'</div></td></tr>';
    }).join('')||'<tr><td colspan="4" class="empty">Saved return verification attempts will appear here.</td></tr>';
    if(jobDetail)jobDetail=jobs().find(item=>item.id===jobDetail.id)??jobDetail;
    renderJobDetail();controls();
  }
  function renderJobDetail(){
    const target=$('adjustment-job-detail');target.hidden=!jobDetail;
    if(!jobDetail){target.innerHTML='';return;}
    target.innerHTML='<h3>Saved verification attempt</h3>'+values([
      ['Job ID',jobDetail.id],['Refund request',jobDetail.adjustmentId],['Status',title(jobDetail.status)],
      ['Transaction',jobDetail.transaction],['RPC endpoint',jobDetail.rpcEndpoint],['Operator',jobDetail.actor],
      ['Created at',date(jobDetail.createdAt)],['Started at',date(jobDetail.startedAt)],['Completed at',date(jobDetail.completedAt)]
    ])+(jobDetail.error?'<h3>Retained result</h3>'+values([['Code',jobDetail.error.code],['Message',jobDetail.error.message]]):'')+
      (jobDetail.result?'<details><summary>Original verification result</summary><pre>'+esc(JSON.stringify(jobDetail.result,null,2))+'</pre></details>':'');
  }
  function renderDetail(){
    $('adjustment-empty').hidden=Boolean(detail);$('adjustment-selected').hidden=!detail;
    if(!detail){controls();return;}
    const event=detail.event,total=detail.totals;
    $('adjustment-title').textContent=event.method+' '+event.routeId;
    $('adjustment-subtitle').textContent=event.eventId+' · '+event.network;
    $('adjustment-status').textContent=summaryStatus(total);
    $('adjustment-totals').innerHTML=metrics([
      ['Original gross · atomic',total.grossAmountAtomic],['Verified returned · atomic',total.refundedAmountAtomic],
      ['Remaining amount · atomic',total.remainingAmountAtomic],['Open requests · atomic',total.pendingRefundAmountAtomic]
    ]);
    $('adjustment-unit').textContent='Amounts belong to this original payment option. Cancellation amount: '+total.cancelledAmountAtomic+' atomic. Available for a new refund request: '+total.availableRefundAmountAtomic+' atomic.';
    $('adjustment-source-values').innerHTML=values([
      ['Event',event.eventId],['Original amount · atomic',event.amountAtomic],['Original event at',date(event.at)],
      ['Source time basis',event.timeBasis],['Origin',event.origin],['Network',event.network],
      ['Payment option',event.optionId],['Asset digest',event.assetDigest],['Recipient digest',event.recipientDigest],
      ['Original transfer classification',event.transfer],['Source identity',detail.source]
    ]);
    renderHistory();
  }
  function renderExports(){
    const exports=(state?.exports??[]).filter(item=>item.runId===runId);
    $('adjustment-downloads').innerHTML=runId?['json','csv','html'].map(format=>'<a class="button" download href="/api/adjustments/export?'+esc(new URLSearchParams({runId,format}).toString())+'">Download current '+format.toUpperCase()+'</a>').join(''):'';
    $('adjustment-exports').innerHTML=exports.map(item=>'<tr><td><strong>'+esc(item.name)+'</strong><span class="subtle mono">'+esc(short(item.runId))+'</span></td><td>'+esc(date(item.createdAt))+'<span class="subtle">'+esc(item.actor)+'</span></td><td><a class="button" download href="/api/exports/'+encode(item.id)+'/download">Download review archive</a><span class="subtle">'+esc(item.bytes)+' bytes</span><details><summary>Archive identity</summary><pre>'+esc(item.sha256)+'</pre></details></td></tr>').join('')||'<tr><td colspan="3" class="empty">Review archives for this reconciliation will appear here.</td></tr>';
    controls();
  }
  async function loadEvents(offset=events.offset){
    if(!runId){events={items:[],total:0,offset:0,limit:PAGE};renderEvents();return;}
    const token=++eventToken,id=runId;
    const result=await api('/api/adjustments/events?'+new URLSearchParams({runId:id,offset:String(offset),limit:String(PAGE),search:$('adjustment-search').value.trim()}));
    if(token!==eventToken||runId!==id)return;
    if(result.total&&offset>=result.total)return loadEvents(Math.floor((result.total-1)/PAGE)*PAGE);
    events=result;renderEvents();
  }
  async function loadDetail(){
    if(!runId||!eventId){detail=null;renderDetail();return;}
    const token=++detailToken,run=runId,event=eventId;
    const result=await api('/api/adjustments/event?'+new URLSearchParams({runId:run,eventId:event}));
    if(token!==detailToken||runId!==run||eventId!==event)return;
    const first=!detail;detail=result;
    if(first)restoreDraft();
    renderDetail();
  }
  async function refresh(){
    if(!state)return;
    const version=state.revision,run=runId;
    await Promise.all([loadEvents(),loadDetail()]);
    if(run===runId)loadedRevision=version;
    renderExports();
  }
  async function selectEvent(id){
    if(id===eventId)return loadDetail();
    saveDraft();eventId=id;detail=null;historyId='';historyOffset=0;jobDetail=null;++jobToken;clearPreview();renderEvents();renderDetail();
    await loadDetail();
  }
  function changeRun(id){
    if(id===runId)return;
    saveDraft();runId=id;eventId='';detail=null;historyId='';historyOffset=0;jobDetail=null;++jobToken;events={items:[],total:0,offset:0,limit:PAGE};
    ++eventToken;++detailToken;loadedRevision=-1;clearPreview();renderEvents();renderDetail();renderExports();
  }
  function requestBody(){
    if(!runId||!eventId)throw new Error('Select the retained original payment.');
    const form=fields(),amountAtomic=form.amountAtomic.trim();
    if(!/^[1-9]\d*$/.test(amountAtomic))throw new Error('Enter a positive whole-number atomic amount without decimal points or separators.');
    const reason=form.reason.trim();if(!reason)throw new Error('Record the reason for this adjustment.');
    return {runId,eventId,kind:form.kind,amountAtomic,effectiveAt:utc(form.effectiveAt),reason,reference:form.reference.trim(),actor:operator()};
  }
  function renderPreview(){
    $('adjustment-preview-panel').hidden=!preview;if(!preview)return;
    const request=preview.request;
    $('adjustment-preview-values').innerHTML=values([
      ['Action',title(request.kind)],['Original event',request.eventId],['Amount · atomic',request.amountAtomic],
      ['Effective at',date(request.effectiveAt)],['Reason',request.reason],['Reference',request.reference||'Not provided'],
      ['Operator',request.actor]
    ]);
    $('adjustment-preview-context').textContent='Reviewed against saved workspace revision '+preview.workspaceRevision+'.';
    $('adjustment-retain').textContent=request.kind==='REFUND'?'Save refund request':'Save cancellation';
    controls();
  }
  $('adjustment-source-form').addEventListener('submit',event=>{event.preventDefault();attempt(()=>{changeRun($('adjustment-run').value);events.offset=0;return refresh();});});
  $('adjustment-run').addEventListener('change',()=>attempt(()=>{changeRun($('adjustment-run').value);return refresh();}));
  $('adjustment-events').addEventListener('click',event=>{const button=event.target.closest('[data-adjustment-event]');if(button)attempt(()=>selectEvent(button.dataset.adjustmentEvent));});
  $('adjustment-previous').addEventListener('click',()=>attempt(()=>loadEvents(Math.max(0,events.offset-PAGE))));
  $('adjustment-next').addEventListener('click',()=>attempt(()=>loadEvents(events.offset+PAGE)));
  $('adjustment-action-form').addEventListener('input',()=>{saveDraft();clearPreview();});
  $('adjustment-action-form').addEventListener('change',()=>{saveDraft();clearPreview();});
  $('operator').addEventListener('input',clearPreview);
  $('adjustment-action-form').addEventListener('submit',event=>{event.preventDefault();attempt(async()=>{
    const body=requestBody(),snapshot=fingerprint(),token=++previewToken;
    localBusy=true;controls();
    try{
      const result=await api('/api/adjustments/preview',body);
      if(token!==previewToken||snapshot!==fingerprint())return;
      if(result.workspaceRevision!==state.revision)adopt(await api('/api/state'));
      if(result.workspaceRevision!==state.revision||snapshot!==fingerprint())throw new Error('The saved workspace changed while preparing this review. Preview the retained draft again.');
      preview=result;previewForm=snapshot;renderPreview();
    }finally{localBusy=false;controls();}
  });});
  $('adjustment-clear-preview').addEventListener('click',clearPreview);
  $('adjustment-retain').addEventListener('click',()=>attempt(async()=>{
    if(!canRetain())throw new Error('Preview the current adjustment before saving it.');
    const reviewed=preview;
    await perform({path:'/api/adjustments/record',body:{...reviewed.request,revision:reviewed.workspaceRevision,previewSha256:reviewed.previewSha256},
      description:'reviewed adjustment',message:reviewed.request.kind==='REFUND'?'Refund request retained. Select it to verify its returned transfer.':'Cancellation retained with its original payment.',
      onConflict:async()=>{clearPreview();adopt(await api('/api/state'));await refresh();},
      success:async result=>{clearPreview();drafts.delete(sourceKey());historyId=result.adjustment.id;await refresh();restoreDraft();if(result.adjustment.kind==='REFUND')$('adjustment-verification-request').value=result.adjustment.id;$('adjustment-transaction').value='';$('adjustment-rpc').value='';renderVerification();}
    });
  }));
  $('adjustment-verification-request').addEventListener('change',()=>{$('adjustment-transaction').value='';$('adjustment-rpc').value='';renderVerification();controls();});
  $('adjustment-verification-form').addEventListener('submit',event=>{event.preventDefault();attempt(async()=>{
    const request=selectedRequest();if(!request)throw new Error('Choose the saved refund request.');
    const transaction=$('adjustment-transaction').value.trim().toLowerCase();
    if(!/^[0-9a-f]{64}$/.test(transaction))throw new Error('Enter the complete 64-character return transaction hash.');
    const rpcEndpoint=$('adjustment-rpc').value.trim();
    await perform({path:'/api/adjustments/'+encode(request.id)+'/verify',body:{revision:state.revision,actor:operator(),transaction,...(rpcEndpoint?{rpcEndpoint}:{})},
      description:'original return verification',message:'Return verification queued. The saved attempt will update here.',
      success:async()=>{await refresh();}
    });
  });});
  $('adjustment-withdraw-form').addEventListener('submit',event=>{event.preventDefault();attempt(async()=>{
    const id=$('adjustment-withdraw-request').value,reason=$('adjustment-withdraw-reason').value.trim();
    if(!id||!reason)throw new Error('Choose a refund request and record its withdrawal reason.');
    await perform({path:'/api/adjustments/'+encode(id)+'/withdraw',body:{revision:state.revision,actor:operator(),reason},
      description:'refund request withdrawal',message:'Refund request withdrawn; its saved history is retained.',
      success:async()=>{await refresh();}
    });
  });});
  $('adjustment-history').addEventListener('click',event=>{const button=event.target.closest('[data-adjustment-history]');if(button){historyId=button.dataset.adjustmentHistory;renderHistory();}});
  $('adjustment-history-previous').addEventListener('click',()=>{historyOffset=Math.max(0,historyOffset-PAGE);renderHistory();});
  $('adjustment-history-next').addEventListener('click',()=>{historyOffset+=PAGE;renderHistory();});
  $('adjustment-jobs').addEventListener('click',event=>{
    const inspect=event.target.closest('[data-adjustment-job]');
    if(inspect){
      const token=++jobToken,key=sourceKey();
      attempt(async()=>{
        const result=await api('/api/adjustments/jobs/'+encode(inspect.dataset.adjustmentJob)),next=await api('/api/state');
        if(token!==jobToken||key!==sourceKey())return;
        jobDetail=result;adopt(next);renderVerification();
      });return;
    }
    const button=event.target.closest('[data-adjustment-retry]');if(!button)return;
    const job=jobs().find(item=>item.id===button.dataset.adjustmentRetry);if(!job)return;
    $('adjustment-verification-request').value=job.adjustmentId;$('adjustment-transaction').value=job.transaction;
    $('adjustment-rpc').value=job.rpcEndpoint??'';renderVerification();
    $('adjustment-transaction').focus();notify('Loaded the saved verification request. Review it, then verify the returned transfer.');
  });
  $('adjustment-export-form').addEventListener('submit',event=>{event.preventDefault();attempt(async()=>{
    if(!runId)throw new Error('Choose the completed reconciliation.');
    await perform({path:'/api/runs/'+encode(runId)+'/exports',body:{revision:state.revision,actor:operator(),includeSources:$('adjustment-export-sources').checked},
      description:'review archive with adjustments',message:'Original review archive retained with its adjustment snapshot.',
      success:()=>{renderExports();}
    });
  });});

  return {
    render(next){
      state=next;
      const runs=state.runs.filter(run=>run.status==='complete'),previous=runId;
      choose($('adjustment-run'),runs.map(run=>[run.id,run.name+' · '+date(run.createdAt)]),'No completed reconciliations',runId);
      if($('adjustment-run').value!==previous)changeRun($('adjustment-run').value);
      $('adjustment-revision').textContent='Saved revision '+state.revision;
      const run=runs.find(item=>item.id===runId);
      $('adjustment-source-context').textContent=run?run.name+' · captured '+date(run.createdAt)+' · '+run.actor:'Capture a reconciliation in Reconcile & review to select its original events.';
      if(lastRevision!==state.revision){if(preview&&preview.workspaceRevision!==state.revision)clearPreview();lastRevision=state.revision;}
      renderExports();renderVerification();controls();
      if(visible&&loadedRevision!==state.revision)attempt(refresh);
    },
    setBusy(value){busy=value;controls();},
    setVisible(value){visible=value;if(value&&state)attempt(refresh);},
    refresh,
    async openEvent(run,event){changeRun(run);$('adjustment-run').value=run;await selectEvent(event);await loadEvents(0);},
    active(){return jobs().some(activeJob);}
  };
}
