// MIT. Complete source-to-accountant return workflow in the retained workspace.
const $=id=>document.getElementById(id);
const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
const exact=value=>value===null?'Unknown':value===undefined?'Not recorded':typeof value==='object'?JSON.stringify(value,null,2):String(value);
const date=value=>value?new Date(value).toLocaleString():'Not recorded';
const short=value=>value?String(value).slice(0,12)+'…':'Not recorded';
const encode=value=>encodeURIComponent(value);
const PAGE=50;
const definitions=value=>Object.entries(value).map(([key,item])=>'<dt>'+esc(key.replace(/([a-z])([A-Z])/g,'$1 $2'))+'</dt><dd>'+esc(exact(item))+'</dd>').join('');
const metrics=entries=>entries.map(([name,value])=>'<div class="metric"><span>'+esc(name)+'</span><strong>'+esc(exact(value))+'</strong></div>').join('');
const options=(element,items,wanted=element.value)=>{
  const html=items.map(([value,name])=>'<option value="'+esc(value)+'">'+esc(name)+'</option>').join('');
  if(element.innerHTML!==html)element.innerHTML=html;
  element.value=items.some(([value])=>value===wanted)?wanted:items[0]?.[0]??'';
};

export async function mountAccountant({api,perform,operator,attempt,notify}){
  const fragment=await fetch('/accountant.html',{cache:'no-store'});
  if(!fragment.ok)throw new Error('The accountant handoff view could not be loaded.');
  $('area-accountant').innerHTML=await fragment.text();
  let state=null,metadata={handoffs:[],closes:[]},busy=false,source=null,sourceKey='',sourceToken=0,refreshToken=0;
  let selected='',detail=null,detailToken=0,revisionChoice='',historyLimit=24,createId=crypto.randomUUID();
  let rows={items:[],total:0,offset:0,limit:PAGE},rowToken=0,selectedRow='';
  let fileData=null,fileToken=0,fileLoading=false,preview=null,previewOffset=0,previewToken=0;
  const labelDrafts=new Map();
  const revisionQuery=()=>revisionChoice?{revisionId:revisionChoice}:{};
  const base=()=>'/api/accountant/handoffs/'+encode(selected);
  function controls(){
    const usable=Boolean(state)&&!busy;
    $('accountant-create').disabled=!usable||!source||source.workspaceRevision!==state?.revision;
    $('accountant-preview').disabled=!usable||!detail||revisionChoice!==''||fileLoading||!fileData;
    $('accountant-apply').disabled=!usable||!preview||revisionChoice!==''||preview.handoffId!==selected||!fileData||fileData.token!==preview.fileToken;
    $('accountant-clear-preview').disabled=busy;
  }
  function invalidatePreview(){preview=null;++previewToken;previewOffset=0;$('accountant-preview-panel').hidden=true;controls();}
  function labelsFromForm(){
    return [...$('accountant-labels').querySelectorAll('tr[data-option]')].map(row=>{
      const label={optionId:row.dataset.option};for(const input of row.querySelectorAll('input[data-field]'))label[input.dataset.field]=input.value.trim();return label;
    });
  }
  function retainLabels(){if(sourceKey&&source)labelDrafts.set(sourceKey,labelsFromForm());}
  function sourceArgs(){
    const [kind,value]=$('accountant-source').value.split(':');
    if(!value)throw new Error('Choose a completed reconciliation or retained period close.');
    return kind==='close'?{closeId:value}:{runId:value};
  }
  async function selectSource(){
    const key=$('accountant-source').value;if(key===sourceKey&&source&&source.workspaceRevision===state.revision)return;
    retainLabels();source=null;sourceKey=key;createId=crypto.randomUUID();const token=++sourceToken;controls();
    $('accountant-labels').innerHTML='';$('accountant-source-summary').textContent=key?'Loading the original source…':'Capture a reconciliation to prepare an accountant handoff.';
    if(!key)return;
    const result=await api('/api/accountant/source?'+new URLSearchParams(sourceArgs()));
    if(token!==sourceToken||key!==sourceKey)return;source=result;
    const draft=new Map((labelDrafts.get(key)??[]).map(item=>[item.optionId,item]));
    $('accountant-labels').innerHTML=result.options.map(option=>{
      const saved=draft.get(option.optionId)??{};
      return '<tr data-option="'+esc(option.optionId)+'"><td><strong>'+esc(option.method+' '+option.routeId)+'</strong><span class="subtle">'+esc(option.network)+'</span><span class="subtle mono">'+esc(short(option.optionId))+'</span><span class="subtle">'+esc(option.amountAtomic)+' atomic per event</span></td>'+[['assetLabel','Asset name'],['unitLabel','Atomic units'],['accountCode','Account code'],['accountName','Account name']].map(([field,hint])=>'<td><input data-field="'+field+'" aria-label="'+esc(hint+' for '+option.method+' '+option.routeId+' '+option.network)+'" maxlength="160" placeholder="'+hint+'" value="'+esc(saved[field]??'')+'"></td>').join('')+'</tr>';
    }).join('')||'<tr><td colspan="5" class="empty">This original report contains no configured payment options.</td></tr>';
    const networks=[...new Set(result.options.map(option=>option.network))];
    $('accountant-source-summary').innerHTML='<p><strong>'+esc(result.run.name)+'</strong> · '+esc(result.rowCount)+' original events · '+esc(networks.join(', ')||'No recorded networks')+'</p><p>'+esc(result.source.periodClose?'Retained period close revision '+result.source.periodClose.revision:'Completed original reconciliation')+' · '+esc(result.totals.officialTransferMatches??0)+' original official transfer matches</p><p class="hint">Each native amount stays in its original asset and atomic unit. Merchant USD quotes retain their original source and unknown values.</p>';
    if(result.adjustments)$('accountant-source-summary').innerHTML+='<p>'+esc(result.adjustments.summary.refundedRows)+' events with verified refunds · '+esc(result.adjustments.summary.cancelledRows)+' events with merchant cancellations. This handoff retains the selected adjustment snapshot and original gross amounts.</p>';
    controls();
  }
  function renderSources(){
    const completed=state.runs.filter(run=>run.status==='complete');
    const choices=[...metadata.closes.map(close=>['close:'+close.id,'Close · '+close.name+' · revision '+close.revision]),...completed.map(run=>['run:'+run.id,'Run · '+run.name+' · '+date(run.createdAt)])];
    options($('accountant-source'),choices.length?choices:[['','No completed sources yet']]);
    attempt(selectSource);
  }
  function renderHistory(){
    const search=$('accountant-search').value.trim().toLowerCase();
    const found=metadata.handoffs.filter(row=>!search||[row.id,row.name,row.actor,row.source.runId,row.source.periodClose?.id].some(value=>String(value??'').toLowerCase().includes(search)));
    $('accountant-list').innerHTML=found.slice(0,historyLimit).map(row=>'<button type="button" data-accountant-id="'+esc(row.id)+'"'+(row.id===selected?' class="selected" aria-current="true"':'')+'><strong>'+esc(row.name)+'</strong><span>'+esc(date(row.createdAt))+' · '+esc(row.rowCount)+' events</span><span>'+esc(row.revisions.length)+' returned versions</span></button>').join('')||'<p class="hint">No saved handoffs match this search.</p>';
    $('accountant-more').hidden=found.length<=historyLimit;
  }
  function renderDetail(){
    $('accountant-selected').hidden=!detail;$('accountant-empty').hidden=Boolean(detail);if(!detail){controls();return;}
    const record=detail.record,current=detail.selectedRevision,summary=current?.summary??{};
    $('accountant-title').textContent=record.name;
    $('accountant-subtitle').textContent='Prepared by '+record.actor+' · '+date(record.createdAt)+' · '+record.rowCount+' original events';
    $('accountant-revision-badge').textContent=current?'Returned · '+current.name:'Original handoff';
    $('accountant-metrics').innerHTML=metrics([['Original events',record.rowCount],['Awaiting review',summary.unreviewedRows??record.rowCount],['Reviewed',summary.reviewedRows??0],['Bookkeeper posted',summary.bookedRows??0],['Bookkeeper excluded',summary.excludedRows??0]]);
    const revisions=[['','Latest retained version'],['initial','Original handoff'],...record.revisions.slice().reverse().map((item,index)=>[item.id,'Return '+(record.revisions.length-index)+' · '+item.name+' · '+date(item.createdAt)])];
    options($('accountant-revision'),revisions,revisionChoice);
    const download=(name,title)=>'<a class="button" download href="'+base()+'/download/'+encode(name)+(revisionChoice?'?'+new URLSearchParams(revisionQuery()):'')+'">'+esc(title)+'</a>';
    $('accountant-downloads').innerHTML=[download('accountant.csv','Accountant CSV'),download('review.html','Offline review'),download('accountant-handoff.tar','Complete handoff archive'),download(current?'return.json':'handoff.json',current?'Returned result JSON':'Handoff JSON')].join('');
    if(detail.source.adjustments)$('accountant-downloads').innerHTML+=[download('adjustments.json','Original adjustments JSON'),download('adjustments.csv','Adjustment history CSV'),download('adjustments.html','Adjustment review')].join('');
    $('accountant-lineage').innerHTML=definitions({...detail.source,preparedBy:record.actor,preparedAt:record.createdAt,...(current?{returnId:current.id,returnedBy:current.actor,returnedAt:current.createdAt}:{} )});
    $('accountant-issues-panel').hidden=!(detail.issues?.length);
    $('accountant-issues').innerHTML=detail.issues?.length?'<pre>'+esc(JSON.stringify(detail.issues,null,2))+'</pre>':'';
    controls();
  }
  async function selectHandoff(handoffId,{reset=true}={}){
    if(selected!==handoffId){selected=handoffId;detail=null;revisionChoice='';invalidatePreview();fileData=null;++fileToken;fileLoading=false;$('accountant-return-file').value='';$('accountant-return-name').value='';$('accountant-file-status').textContent='Choose the returned file to preview its exact matches.';selectedRow='';renderDetail();}
    const token=++detailToken,choice=revisionChoice;renderHistory();
    if(!handoffId){detail=null;renderDetail();return;}
    const result=await api(base()+(choice?'?'+new URLSearchParams({revisionId:choice}):''));
    if(token!==detailToken||selected!==handoffId||choice!==revisionChoice)return;detail=result;renderDetail();await loadRows(reset?0:rows.offset);
  }
  function renderRowDetail(){
    const row=rows.items.find(item=>item.rowId===selectedRow);
    if(!row){$('accountant-row-detail').innerHTML='<p class="hint">Select an event to inspect its exact source and returned fields.</p>';return;}
    $('accountant-row-detail').innerHTML='<h3>Accountant’s returned fields</h3><dl class="record-values">'+definitions({status:row.externalStatus,bookReference:row.externalBookRef,accountCode:row.externalAccountCode,note:row.externalNote,updatedBy:row.updatedBy,updatedAt:row.updatedAt})+'</dl><h3>Merchant’s retained account labels</h3><dl class="record-values">'+definitions(row.label??{})+'</dl>'+(row.adjustments?'<h3>Frozen payment adjustments</h3><dl class="record-values">'+definitions(row.adjustments)+'</dl>':'')+'<h3>Complete original event</h3><dl class="record-values">'+definitions(row.original)+'</dl><details class="history-detail"><summary>Retained row identity</summary><pre>'+esc(JSON.stringify({rowId:row.rowId,eventId:row.eventId,sourceRowSha256:row.sourceRowSha256},null,2))+'</pre></details>';
  }
  function renderRows(){
    $('accountant-rows').innerHTML=rows.items.map(row=>'<tr'+(row.rowId===selectedRow?' class="selected"':'')+'><td><button class="inspect" type="button" data-accountant-row="'+esc(row.rowId)+'">'+esc(row.original.method+' '+row.original.routeId)+'</button><span class="subtle">'+esc(row.original.network)+'</span><span class="subtle mono">'+esc(short(row.eventId))+'</span><span class="subtle">'+esc(row.original.verificationScope)+'</span></td><td class="exact">'+esc(row.original.amountAtomic)+'<span class="subtle">'+esc(row.label?.unitLabel||'atomic units')+'</span>'+(row.adjustments?'<span class="subtle">Returned '+esc(row.adjustments.refundedAmountAtomic)+' · remaining '+esc(row.adjustments.remainingAmountAtomic)+'</span><span class="subtle">Cancelled '+esc(row.adjustments.cancelledAmountAtomic)+' · '+esc(row.adjustments.refundStatus)+'</span>':'')+'</td><td>'+esc(row.externalStatus)+'</td><td>'+esc(row.externalBookRef||'—')+'</td></tr>').join('')||'<tr><td colspan="4" class="empty">No events match these filters.</td></tr>';
    $('accountant-row-page').textContent=rows.total?(rows.offset+1)+'–'+Math.min(rows.offset+rows.items.length,rows.total)+' of '+rows.total+' events':'0 events';
    $('accountant-row-previous').disabled=rows.offset===0;$('accountant-row-next').disabled=rows.offset+rows.items.length>=rows.total;renderRowDetail();
  }
  async function loadRows(offset=0){
    if(!selected||!detail)return;const token=++rowToken,handoffId=selected,choice=revisionChoice;
    const query=new URLSearchParams({...revisionQuery(),offset:String(offset),limit:String(PAGE),status:$('accountant-row-status').value,search:$('accountant-row-search').value});
    const result=await api(base()+'/rows?'+query);if(token!==rowToken||handoffId!==selected||choice!==revisionChoice)return;
    if(result.total&&offset>=result.total)return loadRows(Math.floor((result.total-1)/PAGE)*PAGE);
    rows=result;if(!rows.items.some(row=>row.rowId===selectedRow))selectedRow='';renderRows();
  }
  function renderPreview(){
    $('accountant-preview-panel').hidden=!preview;if(!preview)return;
    const returned=preview.value.revision,summary=returned.summary;
    $('accountant-preview-metrics').innerHTML=metrics([['Matched changes',summary.appliedRows],['Unchanged',summary.unchangedRows],['Conflicts',summary.conflictRows],['Unknown rows',summary.unknownRows],['Missing from return',summary.missingRows]]);
    $('accountant-preview-message').textContent='Saving retains this full file and its matching results. Matched changes update the bookkeeping view; conflicting and missing events keep their previous returned values.';
    const results=returned.results??[];previewOffset=Math.min(previewOffset,Math.max(0,Math.floor((results.length-1)/PAGE)*PAGE));
    $('accountant-preview-results').innerHTML=results.slice(previewOffset,previewOffset+PAGE).map(row=>'<tr><td>'+esc(row.rowNumber)+'</td><td class="mono">'+esc(short(row.eventId))+'</td><td>'+esc(row.status)+'</td><td>'+esc(row.issues?.length?JSON.stringify(row.issues):'Exact original source fields match')+'</td></tr>').join('')||'<tr><td colspan="4" class="empty">The file contains no data rows.</td></tr>';
    $('accountant-preview-page').textContent=results.length?(previewOffset+1)+'–'+Math.min(previewOffset+PAGE,results.length)+' of '+results.length+' returned rows':'0 returned rows';
    $('accountant-preview-previous').disabled=previewOffset===0;$('accountant-preview-next').disabled=previewOffset+PAGE>=results.length;controls();
  }
  async function refresh(next=state){
    if(!next)return;state=next;const token=++refreshToken;
    const current=await api('/api/accountant');if(token!==refreshToken)return;
    metadata=current;renderSources();
    const wanted=metadata.handoffs.some(row=>row.id===selected)?selected:metadata.handoffs[0]?.id??'';
    renderHistory();await selectHandoff(wanted,{reset:false});controls();
  }
  $('accountant-source').addEventListener('change',()=>attempt(selectSource));
  $('accountant-create-form').addEventListener('input',()=>{createId=crypto.randomUUID();retainLabels();});
  $('accountant-create-form').addEventListener('submit',event=>{event.preventDefault();attempt(async()=>{
    if(!source||source.workspaceRevision!==state.revision)throw new Error('Accounting changed. Refresh the selected source before saving this handoff.');
    const body={revision:state.revision,id:createId,...sourceArgs(),name:$('accountant-name').value.trim(),actor:operator(),labels:labelsFromForm()};
    await perform({path:'/api/accountant/handoffs',body,description:'accountant handoff',message:'Accountant handoff retained. Download its CSV or complete archive, then import the returned bookkeeping file.',success:async result=>{createId=crypto.randomUUID();await selectHandoff(result.record.id);await refresh(result.state);}});
  });});
  $('accountant-list').addEventListener('click',event=>{const target=event.target.closest('[data-accountant-id]');if(target)attempt(()=>selectHandoff(target.dataset.accountantId));});
  $('accountant-search').addEventListener('input',()=>{historyLimit=24;renderHistory();});
  $('accountant-more').addEventListener('click',()=>{historyLimit+=24;renderHistory();});
  $('accountant-revision').addEventListener('change',()=>{revisionChoice=$('accountant-revision').value;detail=null;invalidatePreview();selectedRow='';controls();attempt(()=>selectHandoff(selected));});
  $('accountant-return-file').addEventListener('change',()=>attempt(async()=>{
    const file=$('accountant-return-file').files[0],token=++fileToken;fileData=null;fileLoading=false;invalidatePreview();
    if(!file){$('accountant-file-status').textContent='Choose the returned file to preview its exact matches.';controls();return;}
    if(!file.size||file.size>64*1024*1024)throw new Error('Choose a nonempty CSV file up to 64 MiB.');
    fileLoading=true;controls();$('accountant-file-status').textContent='Loading the returned file…';
    try{
      const data=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(new Error('The returned CSV could not be read.'));reader.readAsDataURL(file);});
      if(token!==fileToken)return;fileData={file,token,base64:String(data).slice(String(data).indexOf(',')+1)};
      if(!$('accountant-return-name').value.trim())$('accountant-return-name').value=file.name.replace(/\.csv$/i,'').slice(0,160);
      $('accountant-file-status').textContent=file.name+' · '+file.size+' original bytes loaded';
    }finally{if(token===fileToken){fileLoading=false;controls();}}
  }));
  $('accountant-return-name').addEventListener('input',invalidatePreview);
  $('operator').addEventListener('input',invalidatePreview);
  $('accountant-return-form').addEventListener('submit',event=>{event.preventDefault();attempt(async()=>{
    if(!fileData||fileLoading||$('accountant-return-file').files[0]!==fileData.file)throw new Error('Choose and finish loading the returned CSV.');
    if(revisionChoice!=='')throw new Error('Select the latest retained version before previewing a return.');
    const token=++previewToken,handoffId=selected,loaded=fileData;
    const request={id:crypto.randomUUID(),actor:operator(),name:$('accountant-return-name').value.trim(),csvBase64:loaded.base64,expectedParentId:detail.record.revisions.at(-1)?.id??null};
    const value=await api(base()+'/preview',request);
    if(token!==previewToken||handoffId!==selected||loaded!==fileData)return;
    preview={handoffId,fileToken:loaded.token,value,request:{...request,createdAt:value.revision.createdAt,previewSha256:value.revision.integrity.sha256,revision:value.workspaceRevision}};previewOffset=0;renderPreview();
    $('accountant-preview-panel').scrollIntoView({block:'nearest',behavior:'smooth'});
  });});
  $('accountant-apply').addEventListener('click',()=>attempt(async()=>{
    if(!preview||preview.handoffId!==selected||preview.fileToken!==fileData?.token)throw new Error('Preview the selected returned file before saving.');
    const pending=preview;
    await perform({path:base()+'/returns',body:pending.request,description:'returned bookkeeping import',message:'Matched bookkeeping changes and the full original return are saved. Earlier versions remain available.',success:async result=>{invalidatePreview();fileData=null;$('accountant-return-file').value='';$('accountant-return-name').value='';$('accountant-file-status').textContent='Saved. Choose another returned file to continue this handoff.';revisionChoice='';await refresh(result.state);}});
  }));
  $('accountant-clear-preview').addEventListener('click',invalidatePreview);
  $('accountant-preview-previous').addEventListener('click',()=>{previewOffset=Math.max(0,previewOffset-PAGE);renderPreview();});
  $('accountant-preview-next').addEventListener('click',()=>{previewOffset+=PAGE;renderPreview();});
  $('accountant-row-form').addEventListener('submit',event=>{event.preventDefault();selectedRow='';attempt(()=>loadRows(0));});
  $('accountant-row-previous').addEventListener('click',()=>attempt(()=>loadRows(Math.max(0,rows.offset-PAGE))));
  $('accountant-row-next').addEventListener('click',()=>attempt(()=>loadRows(rows.offset+PAGE)));
  $('accountant-rows').addEventListener('click',event=>{const target=event.target.closest('[data-accountant-row]');if(!target)return;selectedRow=target.dataset.accountantRow;renderRows();$('accountant-row-detail').focus({preventScroll:true});});
  return {render(next){attempt(()=>refresh(next));},refresh(){return refresh();},setBusy(value){busy=value;controls();}};
}
