// MIT. QuickBooks journal handoff in the original merchant accounting workspace.
// Calculations, journal matching and retained accountant revisions belong to the API.
const $=id=>document.getElementById(id);
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const exact=value=>value===null||value===undefined?'Not recorded':typeof value==='object'?JSON.stringify(value,null,2):String(value);
const date=value=>value?new Date(value).toLocaleString():'Not recorded';
const encode=encodeURIComponent;
const short=value=>typeof value==='string'&&value.length>30?value.slice(0,14)+'…'+value.slice(-10):exact(value);
const badge=value=>'<span class="badge">'+esc(value)+'</span>';
const metrics=items=>items.map(([label,value])=>'<div class="metric"><span>'+esc(label)+'</span><strong>'+esc(exact(value))+'</strong></div>').join('');
const definitions=value=>Object.entries(value??{}).map(([key,item])=>'<dt>'+esc(key.replace(/([a-z])([A-Z])/g,'$1 $2'))+'</dt><dd>'+esc(exact(item))+'</dd>').join('');
const PAGE=50,NATIVE_PAGE=20,MAX_ROWS=500,MAX_RESPONSE_BYTES=8*1024*1024;
const query=new URLSearchParams(location.search);
let metadata=null,revision=0,busy=false,pending=null,refreshToken=0,detailToken=0,sourceToken=0,fileToken=0,responseToken=0;
let selected=query.get('plan')||'',detail=null,source=null,sourceChoice='',currentAccountant=null;
let selectedResponse=query.get('response')||'',responseDetail=null,planLimit=24,lineOffset=0,lineIndex=-1,draftOffset=0,comparisonOffset=0,previewOffset=0;
let draftRows=new Map(),draftSelected=new Set(),sourceDrafts=new Map(),planPreview=null,responsePreview=null,loadedFile=null,fileLoading=false,previewUrl='',loadedCompany=null;
let connection=null,connectionIssue='',nativePreview=null,nativeToken=0,nativeAttemptOffset=0,loadedCompanyOrigin=null;
const identity=()=>({id:crypto.randomUUID(),createdAt:new Date().toISOString()});
let createIdentity=identity();
const base=()=>'/api/qbo/plans/'+encode(selected);
const cancelled=()=>detail?.record?.status==='CANCELLED';
const receivable=()=>detail?.record?.status==='REVIEWED'&&!nativeOwnsReturn();
const approved=()=>!cancelled()&&(Boolean(detail?.record?.review)||['REVIEWED','BOOKED'].includes(detail?.record?.status));
const resumable=item=>responseRecord(item)?.status==='PENDING'&&!cancelled();
const cancellable=()=>Boolean(detail)&&!['BOOKED','CANCELLED'].includes(detail.record.status)&&nativeAllowsCancellation()&&!responses().some(item=>responseRecord(item).status==='PENDING');
const eligible=row=>!['BOOKED','EXCLUDED'].includes(String(row?.externalStatus??'').toUpperCase());
const planRows=(plan=detail?.plan)=>plan?.rows??[];
const journal=(plan=detail?.plan)=>plan?.journalEntry??{};
const lines=(plan=detail?.plan)=>journal(plan).Line??[];
const responseRecord=item=>item?.record??item;
const responseResult=item=>item?.result??item;
const responses=()=>detail?.responses??[];
const resultLabel=result=>result?.status==='PENDING'?'Accountant return pending':result?.status==='SAVED'?'Accountant return saved':result?.kind==='MATCHED'?'Journal matched':result?.kind==='FAULT'?'QuickBooks fault':result?.status??'Response retained';
const summaryMetrics=plan=>[['Source events',plan?.summary?.rowCount??planRows(plan).length],['Journal lines',plan?.summary?.lineCount??lines(plan).length],['Debits',plan?.summary?.totalDebit??'See journal'],['Credits',plan?.summary?.totalCredit??'See journal']];
class RequestError extends Error{
  constructor(response,value){super(value.message||value.error||'The workspace request could not be completed.');this.status=response.status;this.code=value.error;}
}
async function api(path,body){
  const response=await fetch(path,body===undefined?{cache:'no-store'}:{method:'POST',headers:{'Content-Type':'application/json','X-Workspace-Request':'1'},body:JSON.stringify(body)});
  const value=await response.json().catch(()=>({message:'The workspace returned an unreadable response.'}));
  if(!response.ok)throw new RequestError(response,value);
  const next=typeof value.revision==='number'?value.revision:value.state?.revision;
  if(typeof next==='number')revision=Math.max(revision,next);
  return value;
}
function notify(message,error=false){$('qbo-message').textContent=message;$('qbo-message').hidden=!message;$('qbo-message').classList.toggle('error',error);}
function attempt(work){return Promise.resolve().then(work).catch(error=>notify(error.message||String(error),true));}
function operator(){const value=$('qbo-operator').value.trim();if(!value){$('qbo-operator').focus();throw new Error('Enter the operator or reviewer name before saving.');}return value;}
function options(element,items,wanted=element.value){
  const html=items.map(([value,label])=>'<option value="'+esc(value)+'">'+esc(label)+'</option>').join('');
  if(element.innerHTML!==html)element.innerHTML=html;
  element.value=items.some(([value])=>value===wanted)?wanted:items[0]?.[0]??'';
}
function showView(view){
  document.querySelectorAll('[data-qbo-view]').forEach(button=>{const active=button.dataset.qboView===view;button.classList.toggle('active',active);if(active)button.setAttribute('aria-current','page');else button.removeAttribute('aria-current');});
  document.querySelectorAll('.qbo-view').forEach(section=>{section.hidden=section.id!=='qbo-view-'+view;});
}
function remember(){
  const url=new URL(location.href);if(selected)url.searchParams.set('plan',selected);else url.searchParams.delete('plan');
  if(selectedResponse)url.searchParams.set('response',selectedResponse);else url.searchParams.delete('response');
  history.replaceState(null,'',url);document.title=(detail?.plan?.name?detail.plan.name+' · ':'')+'QuickBooks journal handoff';
}
function controls(){
  const writable=Boolean(metadata)&&!busy&&!pending;
  $('qbo-refresh').disabled=busy;
  $('qbo-connection-refresh').disabled=busy||Boolean(pending);$('qbo-company-fetch').disabled=!writable||!connection?.available;
  $('qbo-native-refresh').disabled=busy;
  $('qbo-native-preview').disabled=!writable||!nativeCanStart();$('qbo-native-post').disabled=!writable||!nativePreviewCurrent()||!$('qbo-native-confirm').checked;
  $('qbo-native-confirm').disabled=!writable||!nativePreviewCurrent();$('qbo-native-clear-preview').disabled=busy;
  $('qbo-native-resume').disabled=!writable||!nativeCanResume();
  $('qbo-create').disabled=!writable||!source||!draftSelected.size;
  $('qbo-retain-plan').disabled=!writable||!planPreview;
  $('qbo-clear-plan-preview').disabled=busy;
  $('qbo-review').disabled=!writable||!detail||approved()||cancelled();
  $('qbo-cancel').disabled=!writable||!cancellable();
  $('qbo-company-load').disabled=!writable;$('qbo-company-manual').disabled=!writable||!loadedCompany;
  $('qbo-response-resume').disabled=!writable||!resumable(responseDetail);
  document.querySelectorAll('[data-qbo-resume]').forEach(button=>{button.disabled=!writable||cancelled();});
  $('qbo-import').disabled=!writable||!receivable()||fileLoading||!loadedFile;
  $('qbo-apply').disabled=!writable||!responsePreview||!receivable();
  $('qbo-clear-preview').disabled=busy;
  $('qbo-retry').disabled=busy||!pending;$('qbo-dismiss-retry').disabled=busy;
  $('qbo-fill-accounts').disabled=!writable||!draftSelected.size;
  $('qbo-draft-select-page').disabled=!writable||!source;$('qbo-draft-clear').disabled=!writable||!draftSelected.size;
  const sourceById=new Map((source?.rows??[]).map(row=>[row.rowId,row]));
  for(const input of $('qbo-mappings').querySelectorAll('input,textarea')){
    const id=input.closest('[data-qbo-source-row]')?.dataset.qboSourceRow;
    input.disabled=!writable||!eligible(sourceById.get(id))||(input.type!=='checkbox'&&!draftSelected.has(id));
  }
  for(const button of $('qbo-plan-list').querySelectorAll('button'))button.disabled=busy;
  for(const form of ['qbo-create-form','qbo-review-form','qbo-response-form','qbo-company-form','qbo-cancel-form'])for(const input of $(form).querySelectorAll('input,select,textarea'))if(!input.closest('#qbo-mappings'))input.disabled=busy||Boolean(pending)||((form==='qbo-response-form'&&!receivable())||(form==='qbo-review-form'&&cancelled()));
  $('qbo-operator').disabled=busy||Boolean(pending);
  document.body.classList.toggle('working',busy);
}
function invalidatePlan(){planPreview=null;createIdentity=identity();$('qbo-plan-preview-panel').hidden=true;controls();}
function invalidateResponse(){
  responsePreview=null;++responseToken;previewOffset=0;$('qbo-preview-panel').hidden=true;$('qbo-return-empty').hidden=detail?.record?.status==='BOOKED';
  if(previewUrl){URL.revokeObjectURL(previewUrl);previewUrl='';}
  $('qbo-preview-download').hidden=true;$('qbo-preview-download').removeAttribute('href');controls();
}
async function reading(work){if(busy||pending)return;busy=true;controls();try{return await work();}finally{busy=false;controls();}}
async function perform(intent,retrying=false){
  if(busy)return;
  if(pending&&!retrying){notify('Read or dismiss the submitted operation before another write. The form is retained.',true);return;}
  busy=true;controls();let received=false;
  try{
    const result=await api(intent.path,intent.body);received=true;pending=null;$('qbo-retry-panel').hidden=true;
    if(intent.success)await intent.success(result);
    await refresh();notify(typeof intent.message==='function'?intent.message(result):intent.message||'Saved to the original accounting workspace.');
  }catch(error){
    if(received)notify('The operation was saved, but its updated view could not be loaded. Refresh saved state to reopen it. '+error.message,true);
    else if(error.status===409){
      pending=null;$('qbo-retry-panel').hidden=true;invalidatePlan();invalidateResponse();invalidateNative();
      await refresh().catch(()=>{});notify(error.message+' Saved state has changed; the form is retained for a new preview.',true);
    }else if(!error.status||error.status>=500){
      pending=intent;$('qbo-retry-panel').hidden=false;$('qbo-retry-message').textContent=error.message+' The exact operation ID and submitted values remain in this tab.';
      notify('The submitted '+intent.description+' needs a response. Continue using the same operation.',true);
    }else{pending=null;$('qbo-retry-panel').hidden=true;notify(error.message,true);}
  }finally{busy=false;controls();}
}
function pageLabel(prefix,offset,count,total){$(prefix+'-page').textContent=total?(offset+1)+'–'+(offset+count)+' of '+total:'No records';$(prefix+'-previous').disabled=offset===0;$(prefix+'-next').disabled=offset+count>=total;}
function renderIssues(element,issues,title='Details requiring review'){
  const list=Array.isArray(issues)?issues:issues?[issues]:[];element.hidden=!list.length;
  element.innerHTML=list.length?'<h3>'+esc(title)+'</h3><ul>'+list.map(issue=>'<li>'+esc(typeof issue==='string'?issue:issue.message??issue.detail??JSON.stringify(issue))+'</li>').join('')+'</ul>':'';
}
function renderHistory(){
  const search=$('qbo-plan-search').value.trim().toLowerCase();
  const plans=(metadata?.plans??[]).filter(row=>!search||[row.name,row.id,row.realmId,row.companyName,row.handoffId,row.actor].some(value=>String(value??'').toLowerCase().includes(search)));
  $('qbo-plan-list').innerHTML=plans.slice(0,planLimit).map(row=>'<button type="button" data-qbo-plan="'+esc(row.id)+'"'+(selected===row.id?' class="selected" aria-current="true"':'')+'><strong>'+esc(row.name)+'</strong><span>'+esc(row.companyName??row.realmId??'')+' · '+esc(row.environment??'')+'</span><span>'+esc(date(row.createdAt))+' · '+esc(row.nativePost?(nativeLabels[row.nativePost.status]??row.nativePost.status):row.status??'DRAFT')+'</span></button>').join('')||'<p class="hint">No retained plans match this search.</p>';
  $('qbo-plan-more').hidden=plans.length<=planLimit;$('qbo-state-version').textContent='Saved workspace revision '+revision+' · '+(metadata?.plans?.length??0)+' journal plans';
}
function saveDraft(){if(sourceChoice)sourceDrafts.set(sourceChoice,{rows:draftRows,selected:draftSelected});}
async function loadSource({force=false}={}){
  const id=$('qbo-handoff').value;
  if(!id){source=null;renderSource();return;}if(sourceChoice===id&&source&&!force)return;
  if(sourceChoice!==id){saveDraft();const old=sourceDrafts.get(id);draftRows=old?.rows??new Map();draftSelected=old?.selected??new Set();sourceChoice=id;draftOffset=0;source=null;invalidatePlan();}
  const token=++sourceToken;$('qbo-source-description').textContent='Loading the original handoff…';controls();
  const value=await api('/api/qbo/handoffs/'+encode(id));if(token!==sourceToken||id!==sourceChoice)return;
  if(source&&source.expectedParentId!==value.expectedParentId)invalidatePlan();source=value;
  for(const row of source.rows??[])if(!draftRows.has(row.rowId))draftRows.set(row.rowId,{amount:'',debitAccount:{value:'',name:''},creditAccount:{value:'',name:''},description:''});
  const valid=new Set((source.rows??[]).filter(eligible).map(row=>row.rowId)),prior=draftSelected.size;
  draftSelected=new Set([...draftSelected].filter(id=>valid.has(id)));
  if(draftSelected.size<prior)notify('The current bookkeeping state removed '+(prior-draftSelected.size)+' events from this draft selection. Their entered mapping values are retained.');
  if(!$('qbo-name').dataset.dirty)$('qbo-name').value=((source.record?.name??'Merchant settlement')+' · QuickBooks').slice(0,160);
  renderSource();
}
function renderSource(){
  $('qbo-accountant-revision').value=source?(source.expectedParentId?'Saved return '+source.expectedParentId:'Original handoff'):'Choose a handoff';
  if(source){const origin=source.source??source.record?.source??{};
    $('qbo-source-description').innerHTML='<p><strong>'+esc(source.record?.name??'Original accountant handoff')+'</strong> · '+esc(source.rows?.length??0)+' source events</p><p class="hint">'+esc(origin.periodClose?'Retained period close '+origin.periodClose.id+' · version '+origin.periodClose.revision:'Original reconciliation '+(origin.runId??''))+'</p>';
  }else $('qbo-source-description').innerHTML='<p>Prepare an accountant handoff in the merchant workspace, then return here to choose its original events.</p>';
  renderDraftRows();controls();
}
function filteredSourceRows(){const search=$('qbo-draft-search').value.trim().toLowerCase();return (source?.rows??[]).filter(row=>!search||JSON.stringify(row).toLowerCase().includes(search));}
function draftField(id,field,label,value,{amount=false}={}){return '<input data-qbo-field="'+field+'" aria-label="'+esc(label+' for '+id)+'" value="'+esc(value)+'"'+(['debitId','creditId'].includes(field)?' list="qbo-account-options"':'')+(amount?' class="qbo-row-amount" inputmode="decimal" autocomplete="off" placeholder="0.00" maxlength="12"':' maxlength="160"')+'>';}
function renderDraftRows(){
  const rows=filteredSourceRows();draftOffset=Math.min(draftOffset,Math.max(0,Math.floor((rows.length-1)/PAGE)*PAGE));
  const page=rows.slice(draftOffset,draftOffset+PAGE),currency=$('qbo-currency').value.trim();
  $('qbo-mappings').innerHTML=page.map(row=>{
    const d=draftRows.get(row.rowId),chosen=draftSelected.has(row.rowId),label=row.label;
    return '<tr data-qbo-source-row="'+esc(row.rowId)+'"><td><input type="checkbox" data-qbo-selected aria-label="Include '+esc(row.eventId??row.rowId)+'"'+(chosen?' checked':'')+'></td><td><strong>'+esc(row.eventId??row.rowId)+'</strong><span class="subtle">'+esc(row.network??'')+'</span><span class="subtle">'+esc(typeof label==='object'?(label.assetLabel??label.accountName??''):label??'')+'</span><span class="subtle exact">'+esc(row.amountAtomic)+' original atomic units</span><span class="subtle">'+esc(row.externalStatus??'UNREVIEWED')+(row.externalBookRef?' · '+esc(row.externalBookRef):'')+'</span></td><td>'+draftField(row.eventId,'amount','Home-currency amount',d.amount,{amount:true})+'<span class="hint qbo-currency-label">'+esc(currency||'Enter currency above')+'</span></td><td>'+draftField(row.eventId,'debitId','Debit account ID',d.debitAccount.value)+'<span class="qbo-inline-input-label">Account name</span>'+draftField(row.eventId,'debitName','Debit account name',d.debitAccount.name)+'</td><td>'+draftField(row.eventId,'creditId','Credit account ID',d.creditAccount.value)+'<span class="qbo-inline-input-label">Account name</span>'+draftField(row.eventId,'creditName','Credit account name',d.creditAccount.name)+'</td><td><textarea data-qbo-field="description" aria-label="Journal description for '+esc(row.eventId)+'" rows="3" maxlength="2000">'+esc(d.description)+'</textarea></td></tr>';
  }).join('')||'<tr><td colspan="6" class="qbo-empty-row">'+(source?'No source events match this filter.':'Choose a handoff to load its original events.')+'</td></tr>';
  $('qbo-mapping-help').textContent=draftSelected.size+' of '+MAX_ROWS+' supported events selected. Enter each amount in company home currency. Booked and excluded events keep their existing accounting status.';
  pageLabel('qbo-draft',draftOffset,page.length,rows.length);controls();
}
function draftValue(){
  if(!source)throw new Error('Choose an original accountant handoff.');
  const actor=operator(),chosen=(source.rows??[]).filter(row=>draftSelected.has(row.rowId));
  if(!chosen.length||chosen.length>MAX_ROWS)throw new Error('Select between 1 and '+MAX_ROWS+' original events.');
  const rows=chosen.map(row=>{const d=draftRows.get(row.rowId),amount=d.amount.trim();
    if(!eligible(row))throw new Error('The selected event '+(row.eventId??row.rowId)+' already has a booked or excluded status.');
    if(!/^(?:0|[1-9][0-9]{0,8})(?:\.[0-9]{1,2})?$/.test(amount)||!/[1-9]/.test(amount))throw new Error('Enter a positive home-currency amount up to 999999999.99, with at most two decimal places, for '+(row.eventId??row.rowId)+'.');
    if(!d.debitAccount.value.trim()||!d.creditAccount.value.trim())throw new Error('Enter both QuickBooks account IDs for '+(row.eventId??row.rowId)+'.');
    return {rowId:row.rowId,amount,debitAccount:{value:d.debitAccount.value.trim(),name:d.debitAccount.name.trim()},creditAccount:{value:d.creditAccount.value.trim(),name:d.creditAccount.name.trim()},description:d.description.trim()};
  });
  return {...createIdentity,name:$('qbo-name').value.trim(),actor,handoffId:sourceChoice,expectedParentId:source.expectedParentId??null,revision,realmId:$('qbo-realm').value.trim(),companyName:$('qbo-company-name').value.trim(),baseCurrency:$('qbo-currency').value,environment:$('qbo-environment').value,txnDate:$('qbo-date').value,docNumber:$('qbo-doc-number').value.trim(),rows,...(loadedCompany?{companySnapshot:loadedCompany}:{})};
}
function renderPlanPreview(){
  if(!planPreview)return;const p=planPreview.value.plan;
  $('qbo-plan-preview-panel').hidden=false;$('qbo-plan-preview-description').textContent=p.companyName+' · '+p.baseCurrency+' · '+p.environment+' · '+p.txnDate;
  $('qbo-plan-preview-metrics').innerHTML=metrics(summaryMetrics(p));$('qbo-plan-preview-json').textContent=JSON.stringify(journal(p),null,2);
  renderIssues($('qbo-plan-preview-issues'),p.issues);$('qbo-plan-preview-panel').scrollIntoView({block:'nearest',behavior:'smooth'});controls();
}
const download=(filename,label,planId=selected)=>'<a class="button" download href="/api/qbo/plans/'+encode(planId)+'/download/'+encode(filename)+'">'+esc(label??filename)+'</a>';
function renderPlan(){
  $('qbo-selected').hidden=!detail;$('qbo-empty').hidden=Boolean(detail);if(!detail){controls();return;}
  const p=detail.plan,r=detail.record;
  $('qbo-title').textContent=p.name;$('qbo-subtitle').textContent='Prepared by '+p.actor+' · '+date(p.createdAt);
  $('qbo-plan-status').textContent=cancelled()?'Plan cancelled':r.status==='BOOKED'?'Accountant return saved':r.nativePost?(nativeLabels[r.nativePost.status]??r.nativePost.status):approved()?'Journal approved':'Awaiting journal review';
  $('qbo-metrics').innerHTML=metrics(summaryMetrics(p));
  $('qbo-company-summary').innerHTML='<p><strong>'+esc(p.companyName)+'</strong> · Company '+esc(p.realmId)+' · '+esc(p.baseCurrency)+' · '+esc(p.environment)+'</p><p class="hint">Journal date '+esc(p.txnDate)+(p.docNumber?' · Document '+esc(p.docNumber):'')+'</p>';
  $('qbo-lineage').innerHTML=definitions({handoffId:p.handoffId,handoffSha256:p.handoffSha256,accountantVersion:p.accountantRevisionId??'Original handoff',planId:p.id,planSha256:p.integrity.sha256,companyId:p.realmId,homeCurrency:p.baseCurrency,environment:p.environment});
  $('qbo-journal-description').textContent=planRows(p).length+' selected source events, with a debit and credit retained for each event.';$('qbo-balance-status').textContent='Balanced per source event';
  renderIssues($('qbo-plan-issues'),p.issues);$('qbo-request-json').textContent=JSON.stringify(journal(p),null,2);
  $('qbo-request-downloads').innerHTML=[...(approved()?[download('journal-entry.json','QuickBooks journal request')]:[]),download('plan.json','Complete plan JSON'),download('accountant.csv','Source-linked accountant CSV'),download('review.html','Offline journal review')].join('');
  $('qbo-review-form').hidden=approved()||cancelled();
  if(r.status==='BOOKED')$('qbo-file-status').textContent='This journal is booked. Reopen its retained response and original accountant return below.';
  else if(cancelled())$('qbo-file-status').textContent='This journal is cancelled. Its saved source and history remain available.';
  else if(r.status==='DRAFT')$('qbo-file-status').textContent='Approve this retained journal in Journal review before choosing its received response.';
  else if(nativeOwnsReturn())$('qbo-file-status').textContent='Continue the retained native posting in Journal review. Its provider response and original accountant return stay with that operation.';
  else if(!loadedFile)$('qbo-file-status').textContent='Choose the complete received JSON file.';
  $('qbo-cancel-form').hidden=!cancellable();
  $('qbo-cancel-status').textContent=cancelled()?'This plan is cancelled. Create a new journal plan to use these source events.':r.status==='BOOKED'?'The journal is linked to a saved accountant return. Its retained history remains available.':responses().some(item=>responseRecord(item).status==='PENDING')?'Complete the pending accountant return before changing this plan.':!nativeAllowsCancellation()?'Continue the original native posting and reconcile its retained provider result before retiring this journal.':'Cancel this retained plan when it has no saved QuickBooks posting and will not be used. Its source events become available for a new journal plan.';
  $('qbo-review-status').textContent=cancelled()?'Cancelled plans retain their saved source and history.':r.review?'Approved by '+r.review.actor+' · '+date(r.review.createdAt):'Approve the retained source, amounts and accounts to enable its native posting review and exact request download.';
  renderLines();renderResponses();renderFiles();renderNative();controls();
}
function renderLines(){
  const search=$('qbo-line-search').value.trim().toLowerCase(),rows=lines().map((line,index)=>({line,index,source:planRows()[Math.floor(index/2)]})).filter(row=>!search||JSON.stringify(row).toLowerCase().includes(search));
  lineOffset=Math.min(lineOffset,Math.max(0,Math.floor((rows.length-1)/PAGE)*PAGE));const page=rows.slice(lineOffset,lineOffset+PAGE);
  $('qbo-lines').innerHTML=page.map(({line,index,source})=>{const d=line.JournalEntryLineDetail??{},account=d.AccountRef??{};
    return '<tr'+(lineIndex===index?' class="selected"':'')+'><td><button type="button" class="inspect" data-qbo-line="'+index+'">Line '+(index+1)+'</button><span class="subtle">'+esc(source?.eventId??source?.rowId??'')+'</span><span class="subtle">'+esc(line.Description??'')+'</span></td><td>'+esc(account.name||account.value)+'<span class="subtle exact">'+esc(account.value)+'</span></td><td class="qbo-numeric exact">'+(d.PostingType==='Debit'?esc(line.Amount):'—')+'</td><td class="qbo-numeric exact">'+(d.PostingType==='Credit'?esc(line.Amount):'—')+'</td></tr>';
  }).join('')||'<tr><td colspan="4" class="qbo-empty-row">No journal lines match this filter.</td></tr>';
  pageLabel('qbo-line',lineOffset,page.length,rows.length);
  const line=lines()[lineIndex],row=planRows()[Math.floor(lineIndex/2)];
  $('qbo-line-detail').innerHTML=line?'<h3>Journal line '+(lineIndex+1)+'</h3><dl class="record-values">'+definitions({postingType:line.JournalEntryLineDetail.PostingType,account:line.JournalEntryLineDetail.AccountRef,amount:line.Amount,currency:detail.plan.baseCurrency,description:line.Description})+'</dl><h3>Original source and mapping</h3><dl class="record-values">'+definitions(row??{})+'</dl>':'<p class="hint">Select a line to inspect its exact source, account and valuation.</p>';
}
function renderFiles(){
  const files=detail?.record?.files??[];
  $('qbo-files').innerHTML=files.length?'<dl class="record-values">'+files.map(file=>'<dt>'+esc(file.name)+'</dt><dd>'+esc(file.bytes)+' bytes<br><span class="mono">'+esc(file.sha256)+'</span></dd>').join('')+'</dl>':'<p class="hint">The complete plan and source-linked files are available in Journal review.</p>';
}
async function selectPlan(id,{reset=id!==selected}={}){
  const token=++detailToken;selected=id;
  if(reset){invalidateNative();nativeAttemptOffset=0;detail=null;currentAccountant=null;selectedResponse='';responseDetail=null;loadedFile=null;fileLoading=false;++fileToken;invalidateResponse();$('qbo-response-file').value='';$('qbo-response-name').value='';$('qbo-file-status').textContent='Choose the complete received JSON file.';lineOffset=0;lineIndex=-1;comparisonOffset=0;showView('journal');}
  renderHistory();if(!id){detail=null;renderPlan();remember();return;}
  const value=await api('/api/qbo/plans/'+encode(id));if(token!==detailToken||id!==selected)return;
  detail=value;const accountant=await api('/api/accountant/handoffs/'+encode(value.plan.handoffId));if(token!==detailToken||id!==selected)return;
  currentAccountant=accountant;renderPlan();renderAccountant();$('qbo-prepare-panel').open=false;remember();
}
async function refresh(){
  const token=++refreshToken,[value]=await Promise.all([api('/api/qbo'),loadConnection()]);if(token!==refreshToken)return;metadata=value;
  const wanted=sourceChoice||query.get('handoff')||$('qbo-handoff').value;
  options($('qbo-handoff'),value.handoffs?.length?value.handoffs.map(h=>[h.id,h.name+' · '+h.rowCount+' events']):[['','Prepare an accountant handoff first']],wanted);
  renderHistory();if(selected&&value.plans?.some(p=>p.id===selected))await selectPlan(selected,{reset:false});else if(selected){selected='';detail=null;renderPlan();remember();}
  await loadSource({force:true});
  if(planPreview&&planPreview.request.revision!==revision){invalidatePlan();notify('Saved state changed. Your mappings are retained; preview them against the current state.');}
  if(responsePreview&&(responsePreview.request.revision!==revision||responsePreview.request.expectedParentId!==(detail?.expectedParentId??null)||!receivable())){invalidateResponse();notify('The saved accountant state changed. Review the retained response and current posting state.');}
  if(nativePreview&&!nativePreviewCurrent()){invalidateNative();notify('Saved posting state changed. Review the current company and original journal again.');}
  renderNative();controls();
}
function renderResponses(){
  const items=responses();
  options($('qbo-response-select'),items.length?items.map(item=>{const r=responseRecord(item);return [r.id,r.name+' · '+date(r.createdAt)];}):[['','No received responses yet']],selectedResponse);
  selectedResponse=$('qbo-response-select').value;responseDetail=items.find(item=>responseRecord(item).id===selectedResponse)??null;
  $('qbo-response-history').innerHTML=items.map(item=>{const r=responseRecord(item),result=responseResult(item);
    return '<tr><td><strong>'+esc(r.name)+'</strong><span class="subtle">'+esc(result.journalEntryId??'')+'</span></td><td>'+badge(resultLabel(result))+'</td><td>'+esc(r.actor)+'<span class="subtle">'+esc(date(r.createdAt))+'</span></td><td><div class="actions"><button type="button" data-qbo-response="'+esc(r.id)+'">Open response</button>'+(resumable(item)?'<button type="button" data-qbo-resume="'+esc(r.id)+'">Resume return</button>':'')+'</div></td></tr>';
  }).join('')||'<tr><td colspan="4" class="qbo-empty-row">No QuickBooks response has been retained for this plan.</td></tr>';
  renderResponse();controls();
}
function comparisonRows(result){
  if(Array.isArray(result?.rows))return result.rows;
  if(result?.kind!=='MATCHED')return [];
  return planRows().map(row=>({rowId:row.rowId,eventId:row.eventId,status:'MATCHED',expected:{amount:row.amount,currency:detail.plan.baseCurrency,debitAccount:row.debitAccount,creditAccount:row.creditAccount},received:{journalEntryId:result.journalEntryId,syncToken:result.syncToken}}));
}
function renderComparisonRows(result){
  const rows=comparisonRows(result);comparisonOffset=Math.min(comparisonOffset,Math.max(0,Math.floor((rows.length-1)/PAGE)*PAGE));const page=rows.slice(comparisonOffset,comparisonOffset+PAGE);
  $('qbo-comparison-rows').innerHTML=page.map(row=>'<tr><td>'+esc(row.eventId??row.rowId??'')+'</td><td>'+badge(row.status??'Received')+'</td><td class="exact">'+esc(exact(row.expected??''))+'</td><td class="exact">'+esc(exact(row.received??''))+'</td></tr>').join('')||'<tr><td colspan="4" class="qbo-empty-row">This response has no matched journal rows.</td></tr>';
  pageLabel('qbo-comparison',comparisonOffset,page.length,rows.length);
}
function renderResponse(){
  $('qbo-comparison-panel').hidden=!responseDetail;
  if(!responseDetail){$('qbo-response-description').textContent=cancelled()?'This cancelled plan retains its original source and review history.':'Import the complete received response to compare it with this plan.';$('qbo-response-recovery').hidden=true;return;}
  const r=responseRecord(responseDetail),result=responseResult(responseDetail);
  $('qbo-response-description').textContent='Saved by '+(r.actor??'recorded operator')+' · '+date(r.createdAt);
  $('qbo-comparison-description').textContent=(result.journalEntryId?'Received journal '+result.journalEntryId+' · ':'')+resultLabel(result);
  $('qbo-comparison-status').textContent=resultLabel(result);
  $('qbo-comparison-metrics').innerHTML=metrics([['Matched events',result.summary?.matchedRows??0],['QuickBooks journal',result.journalEntryId??'Not recorded'],['Sync token',result.syncToken??'Not recorded'],['Reported issues',result.errors?.length??0]]);
  renderIssues($('qbo-comparison-issues'),result.errors);renderComparisonRows(result);
  $('qbo-response-json').textContent=JSON.stringify(result,null,2);
  const allowed=new Set(['response.json','result.json','returned.csv','return-request.json']);
  const fileList=Array.isArray(r.files)?r.files:Object.entries(r.files??{}).map(([name,value])=>({name,...(typeof value==='object'?value:{sha256:value})}));
  $('qbo-response-downloads').innerHTML=fileList.filter(file=>allowed.has(typeof file==='string'?file:file.name)).map(file=>{const name=typeof file==='string'?file:file.name;return '<a class="button" download href="'+base()+'/responses/'+encode(r.id)+'/download/'+encode(name)+'">'+esc(name)+'</a>';}).join('');
  $('qbo-response-recovery').hidden=!resumable(responseDetail);
  $('qbo-response-recovery-status').textContent=r.lastError?exact(r.lastError)+' The original saved response and operation identity are retained.':'The received journal has been retained. Resume the same saved response to complete its original accountant return.';
  $('qbo-return-eligibility').textContent=r.status==='PENDING'?'The journal response is retained and its accountant return is pending. Resume this saved response to complete the original handoff.':result.kind==='FAULT'?'The original QuickBooks fault is retained for correction. Choose the next received response after resolving the reported issue.':'The saved response and matched accountant return remain attached to the original handoff. Reopen its current accountant version in the next tab.';
  remember();
}
function renderAccountant(){
  if(!currentAccountant)return;
  $('qbo-return-empty').hidden=Boolean(responsePreview)||detail?.record?.status==='BOOKED';
  const empty=$('qbo-return-empty'),nativePending=nativeOwnsReturn();
  empty.querySelector('h2').textContent=nativePending?'Continue the original native posting':'Preview a saved QuickBooks response';
  empty.querySelector('p').textContent=nativePending?nativeStatusDescription(detail.record.nativePost):'The preview compares the journal to its retained request and shows the bookkeeping changes for the current accountant handoff.';
  const next=empty.querySelector('[data-qbo-open]');next.dataset.qboOpen=nativePending?'journal':'response';next.textContent=nativePending?'Open retained posting':'Choose a QuickBooks response';
  const r=currentAccountant.record,current=currentAccountant.selectedRevision,s=current?.summary??{};
  $('qbo-accountant-current').textContent=r.name+' · '+(current?'Current return: '+current.name:'Original handoff')+' · '+r.rowCount+' original events';
  $('qbo-accountant-metrics').innerHTML=metrics([['Original events',r.rowCount],['Reviewed',s.reviewedRows??0],['Bookkeeper posted',s.bookedRows??0],['Returned versions',r.revisions?.length??0]]);
  const original='/api/accountant/handoffs/'+encode(detail.plan.handoffId);
  $('qbo-accountant-downloads').innerHTML=[['accountant.csv','Current accountant CSV'],['review.html','Current offline review'],['accountant-handoff.tar','Complete current handoff']].map(([name,label])=>'<a class="button" download href="'+original+'/download/'+encode(name)+'">'+esc(label)+'</a>').join('');
  $('qbo-accountant-history').innerHTML=[...(r.revisions??[])].reverse().map(item=>'<tr><td>'+esc(item.name)+'</td><td>'+esc(item.actor)+'</td><td>'+esc(date(item.createdAt))+'</td><td>'+esc(item.summary?.reviewedRows??0)+' reviewed / '+esc(item.summary?.bookedRows??0)+' booked</td></tr>').join('')||'<tr><td colspan="4" class="qbo-empty-row">This original handoff has no returned versions yet.</td></tr>';
}
function renderResponsePreview(){
  if(!responsePreview)return;
  const result=responsePreview.value.result,proposed=result.accountantReturn,rows=result.kind==='MATCHED'?planRows():[],summary=proposed?.summary??{};
  $('qbo-preview-panel').hidden=false;$('qbo-return-empty').hidden=true;
  $('qbo-preview-description').textContent=responsePreview.request.name+' · '+resultLabel(result)+(proposed?' · Accountant return '+proposed.id:'');
  $('qbo-preview-metrics').innerHTML=metrics([['Matched events',result.summary?.matchedRows??0],['Return outcome',summary.outcome??'No return'],['Applied rows',summary.appliedRows??0],['Unchanged rows',summary.unchangedRows??0],['Booked rows',summary.bookedRows??0],['Conflicts',summary.conflictRows??0],['Unknown rows',summary.unknownRows??0],['Missing rows',summary.missingRows??0]]);
  renderIssues($('qbo-preview-issues'),result.errors??[]);
  previewOffset=Math.min(previewOffset,Math.max(0,Math.floor((rows.length-1)/PAGE)*PAGE));const page=rows.slice(previewOffset,previewOffset+PAGE);
  $('qbo-preview-rows').innerHTML=page.map(row=>'<tr><td>'+esc(row.eventId??row.rowId)+'</td><td class="exact">'+esc(row.amount)+' '+esc(detail.plan.baseCurrency)+'</td><td>'+esc(row.debitAccount.name||row.debitAccount.value)+'<span class="subtle exact">'+esc(row.debitAccount.value)+'</span></td><td>'+esc(row.creditAccount.name||row.creditAccount.value)+'<span class="subtle exact">'+esc(row.creditAccount.value)+'</span></td></tr>').join('')||'<tr><td colspan="4" class="qbo-empty-row">This received response contains no matched journal events.</td></tr>';
  pageLabel('qbo-preview',previewOffset,page.length,rows.length);
  $('qbo-apply').textContent=result.kind==='FAULT'?'Retain received QuickBooks fault':'Retain response and save accountant return';
  const csv=result.accountantCsv;
  if(typeof csv==='string'&&!previewUrl){previewUrl=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'}));$('qbo-preview-download').href=previewUrl;$('qbo-preview-download').download='quickbooks-accountant-return-preview.csv';$('qbo-preview-download').hidden=false;}
  controls();
}
async function previewResponse(){
  if(!detail||!loadedFile||!receivable())throw new Error('Choose a reviewed journal awaiting its saved QuickBooks response.');
  const id=selected,token=responseToken;
  await reading(async()=>{
    const current=await api('/api/qbo/handoffs/'+encode(detail.plan.handoffId));if(selected!==id||token!==responseToken)return;
    const request={...identity(),revision,actor:operator(),name:$('qbo-response-name').value.trim(),realmId:detail.plan.realmId,responseJson:loadedFile.content,expectedParentId:current.expectedParentId??null};
    const value=await api(base()+'/responses/preview',request);if(selected!==id||token!==responseToken)return;
    responsePreview={planId:id,value,request:{...request,revision:value.revision,previewSha256:value.previewSha256}};
    previewOffset=0;renderResponsePreview();showView('return');notify('The response and proposed accountant return are ready for review.');
  });
}

function renderCompany(){
  const company=loadedCompany,accounts=company?.accounts??[];
  $('qbo-account-options').innerHTML=accounts.filter(a=>a.selectable===true).map(a=>'<option value="'+esc(a.value)+'" label="'+esc((a.name??a.value)+' · '+a.value+' · '+(a.AccountType??''))+'"></option>').join('');
  if(!company){$('qbo-company-source-status').textContent='Company and account fields are entered manually.';return;}
  const usable=accounts.filter(a=>a.selectable===true).length,unavailable=accounts.filter(a=>a.selectable!==true),origin=loadedCompanyOrigin;
  $('qbo-company-source-status').innerHTML='<p><strong>Loaded '+esc(company.companyName)+'</strong> · Company '+esc(company.realmId)+' · Home currency '+esc(company.baseCurrency)+' · '+usable+' selectable accounts</p><p class="hint">'+(origin?.kind==='native'?'Native '+esc(origin.environment)+' capture · '+esc(date(origin.capturedAt))+' · '+esc(origin.sourceRequests.length)+' source requests.':'Loaded from saved company exports.')+' Choose an account ID from this company in each mapping field. Review the entered values with the selected company.</p><details><summary>Company source and unavailable accounts</summary><dl class="record-values">'+definitions({sourceDigests:company.sourceDigests,companySha256:company.integrity?.sha256,multiCurrencyEnabled:company.multiCurrencyEnabled})+'</dl>'+ (unavailable.length?'<p class="hint">'+unavailable.length+' unavailable accounts</p><ul>'+unavailable.map(a=>'<li>'+esc((a.name??a.value)+' · '+a.value+' · '+(Array.isArray(a.reasons)?a.reasons.join('; '):exact(a.reasons??'Unavailable')) )+'</li>').join('')+'</ul>':'<p>All supplied accounts are selectable.</p>')+'</details>';
}
function useManualCompany({message=true}={}){
  loadedCompany=null;loadedCompanyOrigin=null;renderCompany();invalidatePlan();if(message)notify('Company and account fields remain available for manual entry.');
}
function accountName(value){return loadedCompany?.accounts?.find(a=>a.value===value&&a.selectable===true)?.name??'';}
async function readJsonFile(file,label,{allowArray=false}={}){
  if(!file)throw new Error('Choose the '+label+' JSON file.');
  if(file.size===0||file.size>MAX_RESPONSE_BYTES)throw new Error(label+' must contain a JSON object and be no larger than 8 MiB.');
  const content=await file.text();let value;
  try{value=JSON.parse(content);}catch{throw new Error(label+' is not valid JSON. Choose the complete original export.');}
  if(!value||typeof value!=='object'||(!allowArray&&Array.isArray(value)))throw new Error(label+' must contain '+(allowArray?'a JSON object or native account-page array.':'a JSON object.'));
  return content;
}
async function loadCompany(){
  await reading(async()=>{
    const realmId=$('qbo-company-realm').value.trim();
    if(!realmId)throw new Error('Enter the company ID for these saved exports.');
    const files=[$('qbo-company-info-file').files[0],$('qbo-company-preferences-file').files[0],$('qbo-company-accounts-file').files[0]];
    if(files.reduce((total,file)=>total+(file?.size??0),0)>MAX_RESPONSE_BYTES)throw new Error('The complete original company sources must be no larger than 8 MiB.');
    const [companyInfo,preferences,accounts]=await Promise.all(files.map((file,index)=>readJsonFile(file,['CompanyInfo','Preferences','Account'][index],{allowArray:index===2})));
    const value=await api('/api/qbo/company/preview',{realmId,companyInfo,preferences,accounts});
    if(!value.company)throw new Error('The workspace did not return a company setup.');
    loadedCompany=value.company;loadedCompanyOrigin={kind:'files'};$('qbo-realm').value=loadedCompany.realmId;$('qbo-company-name').value=loadedCompany.companyName;$('qbo-currency').value=loadedCompany.baseCurrency;
    renderCompany();invalidatePlan();renderDraftRows();notify('Loaded the company home currency and exported account choices.');
  });
}
async function resumeResponse(id){
  const record=responses().map(responseRecord).find(item=>item.id===id);
  if(!record||!resumable(record))throw new Error('Choose a retained response with a pending accountant return.');
  return perform({path:base()+'/responses/'+encode(id)+'/resume',body:{revision,actor:operator()},description:'saved accountant return',message:'The saved response has been reconciled with its original accountant return.',success:async()=>{selectedResponse=id;invalidateResponse();showView('return');}});
}


// Native requests stay in the original retained plan and accountant workspace.
function connectionSignature(value=connection){
  return JSON.stringify([value?.realmId??null,value?.environment??null,value?.minorVersion??null,Boolean(value?.available)]);
}
function connectionMatches(plan=detail?.plan){
  return Boolean(connection?.available&&plan&&connection.realmId===plan.realmId&&connection.environment===plan.environment);
}
function nativeOwnsReturn(){
  const value=detail?.record?.nativePost;
  return Boolean(value&&!['FAULT','BOOKED'].includes(value.status));
}
function nativeAllowsCancellation(){
  const value=detail?.record?.nativePost;
  return !value||(value.status!=='RUNNING'&&!value.observedJournalId&&!value.sourceAttemptId&&(!value.dispatched||(value.status==='FAULT'&&value.writeAttempts===1)));
}
function nativeCanStart(){
  return detail?.record?.status==='REVIEWED'&&!detail.record.nativePost&&connectionMatches()&&!responses().some(item=>['PENDING','SAVED'].includes(responseRecord(item).status));
}
function nativeConnectionMatches(operation=detail?.record?.nativePost){
  if(!operation||!connectionMatches())return false;
  try{
    const url=new URL(operation.requestUrl);
    return (url.searchParams.get('minorversion')??null)===(connection.minorVersion===null||connection.minorVersion===undefined?null:String(connection.minorVersion));
  }catch{return false;}
}
function nativeCanResume(){
  const value=detail?.record?.nativePost;
  if(!value||cancelled()||!['PREPARED','RETRYABLE','UNCERTAIN','RECEIVED','FAULT','CONFLICT'].includes(value.status))return false;
  if(value.retryAt&&Date.now()<Date.parse(value.retryAt))return false;
  return value.status==='RECEIVED'||nativeConnectionMatches(value);
}
function nativePreviewCurrent(){
  return Boolean(nativePreview&&nativeCanStart()&&nativePreview.planId===selected&&nativePreview.request.revision===revision&&nativePreview.request.expectedParentId===(detail?.expectedParentId??null)&&nativePreview.request.actor===$('qbo-operator').value.trim()&&nativePreview.connection===connectionSignature()&&nativePreview.value.preview.planSha256===detail?.plan?.integrity?.sha256);
}
function invalidateNative(){
  nativePreview=null;++nativeToken;$('qbo-native-preview-panel').hidden=true;$('qbo-native-confirm').checked=false;controls();
}
function setConnection(value){
  const prior=connectionSignature();connection=value;connectionIssue='';
  if(prior!==connectionSignature()&&nativePreview)invalidateNative();
  renderConnection();renderNative();
}
function renderConnection(){
  const available=Boolean(connection?.available);
  $('qbo-connection-status').textContent=connectionIssue?'Unavailable':available?'Configured':connection?'Setup required':'Loading';
  $('qbo-connection-description').textContent=connectionIssue?connectionIssue:available?'The accounting server is configured for '+connection.environment+' company '+connection.realmId+'. Load its current company setup to review the native account choices.':connection?'Configure the QuickBooks company connection in the accounting server, then refresh it here.':'Reading the accounting server connection…';
  $('qbo-connection-details').innerHTML=connection?definitions({companyId:connection.realmId??'Not configured',environment:connection.environment,minorVersion:connection.minorVersion??'Provider default',
    ...(connection.authorization?.kind==='oauth-connection'?{company:connection.authorization.companyName??'Load current company setup',connection:connection.authorization.alias,reviewedGrant:connection.authorization.grantId}: {})}):'';
  $('qbo-connection-config').textContent=connection?.authorization?.kind==='oauth-connection'?
    'Authorization uses the reviewed '+connection.authorization.alias+' connection. The connection workspace manages its grant, renewal and disconnect. Use its saved company selection when reopening this accounting workspace.'+
      (connection.authorization.lastError?' Last authorization result: '+connection.authorization.lastError+'.':''):
    'The server reads '+(connection?.tokenEnv??'STARFORGE_QBO_ACCESS_TOKEN')+' through its existing authorized account, or a configured OAuth token provider. STARFORGE_QBO_REALM_ID selects the company and STARFORGE_QBO_ENVIRONMENT selects sandbox or production. Set these in the accounting server process, then refresh this connection.';
  controls();
}
async function loadConnection(){
  try{setConnection(await api('/api/qbo/connection'));}
  catch(error){connection=null;connectionIssue=error.message||'The accounting server connection could not be read.';invalidateNative();renderConnection();renderNative();}
}
async function loadNativeCompany(){
  await reading(async()=>{
    await loadConnection();
    if(!connection?.available)throw new Error(connectionIssue||'Configure the company connection in the accounting server before loading its source.');
    const target={realmId:connection.realmId,environment:connection.environment};
    $('qbo-connection-description').textContent='Loading CompanyInfo, Preferences and every page of the native chart of accounts…';
    try{
      const value=await api('/api/qbo/company/fetch',target),company=value.company;
      if(!company||company.realmId!==target.realmId||value.connection?.realmId!==target.realmId||value.connection?.environment!==target.environment)throw new Error('The loaded company does not match the selected server connection. Refresh its configuration.');
      setConnection(value.connection);loadedCompany=company;loadedCompanyOrigin={kind:'native',capturedAt:value.capturedAt,environment:target.environment,sourceRequests:value.sourceRequests??[]};
      $('qbo-realm').value=company.realmId;$('qbo-company-realm').value=company.realmId;$('qbo-company-name').value=company.companyName;$('qbo-currency').value=company.baseCurrency;$('qbo-environment').value=target.environment;
      renderCompany();invalidatePlan();renderDraftRows();$('qbo-prepare-panel').open=true;
      $('qbo-company-source-status').scrollIntoView({block:'nearest',behavior:'smooth'});
      notify('Loaded '+company.companyName+' from '+target.environment+' company '+target.realmId+'. Review the retained mapping values and home-currency amounts with this company.');
    }finally{renderConnection();}
  });
}
const nativeLabels={PREPARED:'Prepared',RUNNING:'In progress',RETRYABLE:'Ready to resume',UNCERTAIN:'Response uncertain',RECEIVED:'Response received',BOOKED:'Accountant return saved',FAULT:'Provider fault',CONFLICT:'Journal reconciliation'};
function nativeStatusDescription(value){
  if(!value)return '';
  const descriptions={
    PREPARED:'The exact reviewed request and posting identity are retained. Continue this operation to receive the native result.',
    RUNNING:'The accounting server is finding or posting the original journal. Refresh saved state to read its result.',
    RETRYABLE:'The original operation can continue with its retained company, request ID and journal body.',
    UNCERTAIN:'A complete posting outcome is still being reconciled. Resume this operation to find the original journal and continue with the same request ID.',
    RECEIVED:'The native journal response is retained. Resume to complete its original accountant return from those saved bytes.',
    BOOKED:'The native journal is matched to the reviewed plan and linked to its saved original accountant return.',
    FAULT:'QuickBooks returned a retained fault. Read its response, resolve the reported company or journal issue, then continue the original operation or cancel a confirmed unused plan.',
    CONFLICT:'The retained native journal requires reconciliation with this reviewed source. Inspect its exact response and original accounting history, then recheck this operation.'
  };
  return descriptions[value.status]??'Read the retained operation and its provider response files.';
}
function nativeFileLinks(files,prefix,allowed){
  return (files??[]).filter(file=>allowed.includes(file.name)).map(file=>'<div><a class="button" download href="'+prefix+'/'+encode(file.name)+'">'+esc(file.name)+'</a><p class="hint">'+esc(file.bytes)+' bytes · <span class="mono">'+esc(file.sha256)+'</span></p></div>').join('');
}
function renderNativeAttempts(){
  const operation=detail?.record?.nativePost,items=[...(operation?.attempts??[])].reverse();
  $('qbo-native-attempts-panel').hidden=!operation;
  $('qbo-native-attempts-summary').textContent='Native request and response history · '+items.length+' retained attempts';
  nativeAttemptOffset=Math.min(nativeAttemptOffset,Math.max(0,Math.floor((items.length-1)/NATIVE_PAGE)*NATIVE_PAGE));
  const page=items.slice(nativeAttemptOffset,nativeAttemptOffset+NATIVE_PAGE);
  $('qbo-native-attempts').innerHTML=page.map(item=>{
    const request=item.request??{},headers=item.headers??{},prefix=base()+'/post/attempts/'+encode(item.id)+'/download';
    return '<tr><td><strong>'+esc(item.kind)+'</strong><span class="subtle">'+esc(date(item.receivedAt))+'</span><span class="subtle exact">'+esc(item.id)+'</span></td><td>'+badge('HTTP '+item.status)+'<span class="subtle">'+esc(item.responseBytes)+' response bytes</span>'+(headers.intuit_tid?'<span class="subtle">Intuit trace '+esc(headers.intuit_tid)+'</span>':'')+(headers['retry-after']?'<span class="subtle">Retry-After '+esc(headers['retry-after'])+'</span>':'')+'</td><td><strong>'+esc(request.method)+'</strong><span class="subtle">'+esc(request.environment)+' · Company '+esc(request.realmId)+'</span><span class="subtle exact">'+esc(request.requestId??'Read request')+'</span><details><summary>Exact request URL and response digest</summary><p class="exact">'+esc(request.url)+'</p><p class="mono">'+esc(item.responseSha256)+'</p></details></td><td><div class="qbo-file-list">'+nativeFileLinks(item.files,prefix,['response.json','receipt.json'])+'</div></td></tr>';
  }).join('')||'<tr><td colspan="4" class="qbo-empty-row">The operation has no complete provider response yet.</td></tr>';
  pageLabel('qbo-native-attempt',nativeAttemptOffset,page.length,items.length);
}
function renderNative(){
  if(!detail)return;
  const record=detail.record,plan=detail.plan,value=record.nativePost,target=plan.environment+' company '+plan.realmId;
  $('qbo-native-status').textContent=value?(nativeLabels[value.status]??value.status):record.status==='REVIEWED'?'Ready for review':record.status==='BOOKED'?'Accountant return saved':cancelled()?'Cancelled':'Review required';
  let message;
  if(value)message=nativeStatusDescription(value);
  else if(cancelled())message='This journal is cancelled. Its retained source and history remain available.';
  else if(record.status==='BOOKED')message='The original accountant return for this journal is already saved. Open its retained response and return.';
  else if(record.status!=='REVIEWED')message='Approve the retained journal before reviewing its posting to '+target+'.';
  else if(responses().some(item=>['PENDING','SAVED'].includes(responseRecord(item).status)))message='Continue the retained QuickBooks response and original accountant return for this journal.';
  else if(!connection?.available)message='Configure the accounting server connection for '+target+', then refresh it to review this posting.';
  else if(!connectionMatches())message='This retained journal belongs to '+target+'. The server currently selects '+connection.environment+' company '+connection.realmId+'. Select the journal’s original company in the server configuration.';
  else message='Review the exact request for '+target+'. This posting keeps the native journal and original accountant return together.';
  $('qbo-native-description').textContent=message;
  $('qbo-native-preview').hidden=Boolean(value)||['BOOKED','CANCELLED'].includes(record.status);
  $('qbo-native-operation').hidden=!value;
  if(nativePreview&&!nativePreviewCurrent())invalidateNative();
  if(value){
    $('qbo-native-operation-description').textContent=nativeStatusDescription(value);
    $('qbo-native-operation-details').innerHTML=definitions({requestId:value.requestId??value.id,companyId:value.realmId,environment:value.environment,documentNumber:value.docNumber,operator:value.actor,preparedAt:value.createdAt,updatedAt:value.updatedAt,journalEntryId:value.journalEntryId??'Awaiting matched journal',observedJournalId:value.observedJournalId??'No journal observed',writeAttempts:value.writeAttempts??0,responseId:value.responseId??'Awaiting accountant return',requestSha256:value.requestSha256,planSha256:value.planSha256});
    const error=value.lastError;$('qbo-native-error').hidden=!error;$('qbo-native-error').textContent=error?((error.code?error.code+' · ':'')+(error.message??exact(error))):'';
    const wait=value.retryAt&&Date.now()<Date.parse(value.retryAt);$('qbo-native-retry-status').hidden=!value.retryAt;
    $('qbo-native-retry-status').textContent=value.retryAt?(wait?'QuickBooks requested a pause until '+date(value.retryAt)+'. Refresh saved state at or after that time to continue the original request.':'The retained retry time has passed. The original operation can be resumed.'):'';
    $('qbo-native-resume').hidden=value.status==='BOOKED'||cancelled();
    $('qbo-native-resume').textContent=value.status==='RECEIVED'?'Complete saved accountant return':value.status==='CONFLICT'?'Recheck original journal':value.status==='FAULT'?'Recheck original posting':'Resume original posting';
    if(!['BOOKED','RUNNING','RECEIVED'].includes(value.status)&&!nativeConnectionMatches(value))$('qbo-native-operation-description').textContent+=' Restore its original company, environment and minor-version configuration to continue.';
    $('qbo-native-open-response').hidden=!value.responseId;$('qbo-native-open-return').hidden=value.status!=='BOOKED';
    $('qbo-native-downloads').innerHTML=nativeFileLinks(value.files,base()+'/post/download',['intent.json','request.json']);
  }
  renderNativeAttempts();controls();
}
async function previewNative(){
  await reading(async()=>{
    await loadConnection();
    if(!nativeCanStart())throw new Error('Choose a reviewed journal for the configured company, with no retained posting or pending response.');
    invalidateNative();invalidateResponse();
    const planId=selected,token=nativeToken,request={...identity(),actor:operator(),expectedParentId:detail.expectedParentId??null,revision},signature=connectionSignature();
    const value=await api(base()+'/post/preview',request);
    if(token!==nativeToken||planId!==selected||signature!==connectionSignature())return;
    nativePreview={planId,request:{...request,revision:value.revision,previewSha256:value.previewSha256},connection:signature,value};
    const p=value.preview;
    if(!nativePreviewCurrent()){invalidateNative();throw new Error('The saved journal changed during posting review. Refresh its state and review the current request.');}
    $('qbo-native-preview-panel').hidden=false;$('qbo-native-preview-description').textContent=detail.plan.companyName+' · '+p.environment+' company '+p.realmId+' · '+detail.plan.baseCurrency;
    $('qbo-native-preview-metrics').innerHTML=metrics(summaryMetrics({summary:p.summary}));
    $('qbo-native-preview-details').innerHTML=definitions({companyId:p.realmId,environment:p.environment,documentNumber:p.docNumber,journalDate:detail.plan.txnDate,operator:p.actor,requestId:p.requestId,preparedAt:p.createdAt,accountantVersion:p.expectedParentId??'Original handoff',requestUrl:p.requestUrl,requestSha256:p.requestSha256,planSha256:p.planSha256});
    $('qbo-native-confirm-label').textContent='I reviewed the company, journal date, accounts and amounts for posting to '+p.environment+' company '+p.realmId+'.';
    $('qbo-native-preview-panel').scrollIntoView({block:'nearest',behavior:'smooth'});controls();notify('The exact company and native journal request are ready for posting review.');
  });
}
function nativeResultMessage(result){
  const value=result.nativePost??result.record?.nativePost;
  if(value?.status==='BOOKED')return 'QuickBooks journal '+value.journalEntryId+' is matched and linked to the original saved accountant return.';
  return (nativeLabels[value?.status]??'Posting state saved')+'. '+nativeStatusDescription(value);
}
async function nativeSuccess(result){
  invalidateNative();invalidateResponse();
  const value=result.nativePost??result.record?.nativePost;
  if(value?.responseId)selectedResponse=value.responseId;
  showView(value?.status==='BOOKED'?'return':'journal');
}
async function postNative(){
  if(!nativePreviewCurrent()||!$('qbo-native-confirm').checked)throw new Error('Review and confirm this exact company and journal before posting.');
  const intent=nativePreview;
  return perform({path:'/api/qbo/plans/'+encode(intent.planId)+'/post',body:intent.request,description:'native QuickBooks posting',message:nativeResultMessage,success:nativeSuccess});
}
async function resumeNative(){
  const value=detail?.record?.nativePost;
  if(!value||!nativeCanResume())throw new Error(value?.retryAt&&Date.now()<Date.parse(value.retryAt)?'QuickBooks requested a pause until '+date(value.retryAt)+'.':'Refresh the retained operation and its original company configuration before resuming.');
  return perform({path:base()+'/post/resume',body:{id:value.id,revision,actor:operator()},description:'original native QuickBooks posting',message:nativeResultMessage,success:nativeSuccess});
}

$('qbo-date').value=new Date().toISOString().slice(0,10);
$('qbo-company-form').addEventListener('submit',event=>{event.preventDefault();attempt(loadCompany);});
$('qbo-company-manual').addEventListener('click',()=>useManualCompany());
$('qbo-connection-refresh').addEventListener('click',()=>attempt(()=>reading(loadConnection)));
$('qbo-company-fetch').addEventListener('click',()=>attempt(loadNativeCompany));
$('qbo-native-preview').addEventListener('click',()=>attempt(previewNative));
$('qbo-native-confirm').addEventListener('change',controls);
$('qbo-native-post').addEventListener('click',()=>attempt(postNative));
$('qbo-native-resume').addEventListener('click',()=>attempt(resumeNative));
$('qbo-native-clear-preview').addEventListener('click',invalidateNative);
$('qbo-native-refresh').addEventListener('click',()=>attempt(async()=>{if(busy)return;busy=true;controls();try{await refresh();}finally{busy=false;controls();}}));
$('qbo-native-open-response').addEventListener('click',()=>{const id=detail?.record?.nativePost?.responseId;if(id)chooseResponse(id);});
$('qbo-native-attempt-previous').addEventListener('click',()=>{nativeAttemptOffset=Math.max(0,nativeAttemptOffset-NATIVE_PAGE);renderNativeAttempts();});
$('qbo-native-attempt-next').addEventListener('click',()=>{nativeAttemptOffset+=NATIVE_PAGE;renderNativeAttempts();});
$('qbo-create-form').addEventListener('submit',event=>{
  event.preventDefault();attempt(()=>reading(async()=>{
    const request=draftValue(),token=createIdentity.id;
    const value=await api('/api/qbo/preview',request);
    if(token!==createIdentity.id)return;
    planPreview={value,request:{...request,revision:value.revision,previewSha256:value.previewSha256}};
    renderPlanPreview();notify('The source, company and journal mapping are ready to retain.');
  }));
});
$('qbo-retain-plan').addEventListener('click',()=>attempt(async()=>{
  if(!planPreview)throw new Error('Preview the current source and mapping before retaining a journal plan.');
  const intent=planPreview;
  await perform({path:'/api/qbo/plans',body:intent.request,description:'journal plan',message:'The journal plan is retained with its original source and explicit account mapping.',success:async result=>{
    invalidatePlan();await selectPlan(result.record.id,{reset:true});$('qbo-review-note').value='';$('qbo-cancel-note').value='';$('qbo-cancel-unused').checked=false;
  }});
}));
$('qbo-clear-plan-preview').addEventListener('click',()=>{invalidatePlan();$('qbo-prepare-panel').open=true;});
$('qbo-review-form').addEventListener('submit',event=>{
  event.preventDefault();attempt(async()=>{
    if(!detail||approved()||cancelled())return;
    const body={id:crypto.randomUUID(),revision,actor:operator(),note:$('qbo-review-note').value.trim(),planSha256:detail.plan.integrity.sha256};
    if(!body.note)throw new Error('Enter a review note for the retained journal.');
    await perform({path:base()+'/review',body,description:'journal approval',message:'The reviewed journal is ready for native posting review and exact request download.'});
  });
});
$('qbo-cancel-form').addEventListener('submit',event=>{
  event.preventDefault();attempt(async()=>{
    if(!cancellable())throw new Error('This journal plan cannot be cancelled in its current saved state.');
    const body={id:crypto.randomUUID(),revision,actor:operator(),note:$('qbo-cancel-note').value.trim(),planSha256:detail.plan.integrity.sha256,unusedConfirmed:$('qbo-cancel-unused').checked};
    if(!body.note||!body.unusedConfirmed)throw new Error('Enter a cancellation note and confirm the journal has not been used.');
    await perform({path:base()+'/cancel',body,description:'unused journal cancellation',message:'The unused journal plan is cancelled. Its source events are available for a new plan.',success:async()=>{invalidateResponse();invalidateNative();$('qbo-cancel-unused').checked=false;}});
  });
});
$('qbo-handoff').addEventListener('change',()=>attempt(()=>reading(()=>loadSource())));
$('qbo-operator').addEventListener('input',()=>{invalidatePlan();invalidateResponse();invalidateNative();});
$('qbo-create-form').addEventListener('input',event=>{
  const input=event.target;
  if(input.id==='qbo-draft-search'||input.id.startsWith('qbo-default-')||input.matches('[data-qbo-selected]'))return;
  if(input.id==='qbo-name')input.dataset.dirty='true';
  if(['qbo-realm','qbo-company-name','qbo-currency','qbo-environment'].includes(input.id)&&loadedCompany)useManualCompany({message:false});
  const field=input.dataset.qboField;
  if(field){
    const id=input.closest('[data-qbo-source-row]')?.dataset.qboSourceRow,row=draftRows.get(id);
    if(!row)return;
    if(field==='debitId'){row.debitAccount.value=input.value;if(!row.debitAccount.name){row.debitAccount.name=accountName(input.value.trim());const name=input.closest('td').querySelector('[data-qbo-field="debitName"]');if(name)name.value=row.debitAccount.name;}}
    else if(field==='creditId'){row.creditAccount.value=input.value;if(!row.creditAccount.name){row.creditAccount.name=accountName(input.value.trim());const name=input.closest('td').querySelector('[data-qbo-field="creditName"]');if(name)name.value=row.creditAccount.name;}}
    else if(field==='debitName')row.debitAccount.name=input.value;
    else if(field==='creditName')row.creditAccount.name=input.value;
    else if(field==='amount'||field==='description')row[field]=input.value;
  }
  invalidatePlan();
  if(input.id==='qbo-currency')document.querySelectorAll('.qbo-currency-label').forEach(label=>{label.textContent=input.value||'Enter currency above';});
});
$('qbo-mappings').addEventListener('change',event=>{
  const checkbox=event.target.closest('[data-qbo-selected]');if(!checkbox)return;
  const id=checkbox.closest('[data-qbo-source-row]').dataset.qboSourceRow,row=source?.rows?.find(item=>item.rowId===id);
  if(!eligible(row)){checkbox.checked=false;return;}
  if(checkbox.checked&&draftSelected.size>=MAX_ROWS&&!draftSelected.has(id)){checkbox.checked=false;notify('A journal plan supports up to '+MAX_ROWS+' original events.',true);return;}
  if(checkbox.checked)draftSelected.add(id);else draftSelected.delete(id);
  invalidatePlan();renderDraftRows();
});
$('qbo-draft-search').addEventListener('input',()=>{draftOffset=0;renderDraftRows();});
$('qbo-draft-select-page').addEventListener('click',()=>{
  const rows=filteredSourceRows().slice(draftOffset,draftOffset+PAGE).filter(eligible),next=new Set([...draftSelected,...rows.map(row=>row.rowId)]);
  if(next.size>MAX_ROWS){notify('This page would exceed '+MAX_ROWS+' events. Select individual events or clear part of the existing selection.',true);return;}
  draftSelected=next;invalidatePlan();renderDraftRows();
});
$('qbo-draft-clear').addEventListener('click',()=>{draftSelected.clear();invalidatePlan();renderDraftRows();});
$('qbo-draft-previous').addEventListener('click',()=>{draftOffset=Math.max(0,draftOffset-PAGE);renderDraftRows();});
$('qbo-draft-next').addEventListener('click',()=>{draftOffset+=PAGE;renderDraftRows();});
$('qbo-fill-accounts').addEventListener('click',()=>{
  const defaults={debitAccount:{value:$('qbo-default-debit-id').value.trim(),name:$('qbo-default-debit-name').value.trim()},creditAccount:{value:$('qbo-default-credit-id').value.trim(),name:$('qbo-default-credit-name').value.trim()}};
  let changed=0;
  for(const id of draftSelected){const row=draftRows.get(id);if(!row)continue;for(const side of ['debitAccount','creditAccount'])for(const field of ['value','name'])if(!row[side][field].trim()&&defaults[side][field]){row[side][field]=defaults[side][field];changed++;}}
  invalidatePlan();renderDraftRows();notify(changed?'Filled '+changed+' blank account fields across the selected events.':'Enter account defaults to fill the selected events’ blank fields.');
});
for(const [id,name] of [['qbo-default-debit-id','qbo-default-debit-name'],['qbo-default-credit-id','qbo-default-credit-name']])$(id).addEventListener('change',()=>{if(!$(name).value.trim())$(name).value=accountName($(id).value.trim());});
$('qbo-plan-search').addEventListener('input',()=>{planLimit=24;renderHistory();controls();});
$('qbo-plan-more').addEventListener('click',()=>{planLimit+=24;renderHistory();controls();});
$('qbo-plan-list').addEventListener('click',event=>{
  const button=event.target.closest('[data-qbo-plan]');if(!button)return;
  attempt(()=>reading(()=>selectPlan(button.dataset.qboPlan)));
});
$('qbo-refresh').addEventListener('click',()=>attempt(async()=>{
  if(busy)return;busy=true;controls();try{await refresh();notify(pending?'Saved state refreshed. The submitted operation remains available to read or retry.':'Saved state refreshed. Entered mappings and response files remain in this tab.');}finally{busy=false;controls();}
}));
document.querySelectorAll('[data-qbo-view]').forEach(button=>button.addEventListener('click',()=>showView(button.dataset.qboView)));
document.querySelectorAll('[data-qbo-open]').forEach(button=>button.addEventListener('click',()=>showView(button.dataset.qboOpen)));
$('qbo-line-filter').addEventListener('submit',event=>{event.preventDefault();lineOffset=0;renderLines();});
$('qbo-line-previous').addEventListener('click',()=>{lineOffset=Math.max(0,lineOffset-PAGE);renderLines();});
$('qbo-line-next').addEventListener('click',()=>{lineOffset+=PAGE;renderLines();});
$('qbo-lines').addEventListener('click',event=>{
  const button=event.target.closest('[data-qbo-line]');if(!button)return;lineIndex=Number(button.dataset.qboLine);renderLines();$('qbo-line-detail').focus();
});
$('qbo-response-file').addEventListener('change',()=>attempt(async()=>{
  loadedFile=null;invalidateResponse();const token=++fileToken,file=$('qbo-response-file').files[0];
  $('qbo-file-status').textContent='Choose the complete received JSON file.';
  if(!file){fileLoading=false;controls();return;}
  fileLoading=true;controls();$('qbo-file-status').textContent='Reading '+file.name+'…';
  try{
    const content=await readJsonFile(file,'QuickBooks response');if(token!==fileToken)return;
    loadedFile={name:file.name,content,token};$('qbo-file-status').textContent=file.name+' · '+file.size.toLocaleString()+' bytes ready for comparison';
    if(!$('qbo-response-name').value.trim())$('qbo-response-name').value=file.name.replace(/\.json$/i,'').slice(0,160);
  }catch(error){if(token===fileToken){$('qbo-file-status').textContent=error.message;throw error;}}
  finally{if(token===fileToken){fileLoading=false;controls();}}
}));
$('qbo-response-name').addEventListener('input',invalidateResponse);
$('qbo-response-form').addEventListener('submit',event=>{event.preventDefault();attempt(previewResponse);});
function chooseResponse(id){
  selectedResponse=id;responseDetail=responses().find(item=>responseRecord(item).id===id)??null;comparisonOffset=0;invalidateResponse();renderResponses();showView('response');
}
$('qbo-response-select').addEventListener('change',()=>chooseResponse($('qbo-response-select').value));
$('qbo-response-history').addEventListener('click',event=>{
  const open=event.target.closest('[data-qbo-response]'),resume=event.target.closest('[data-qbo-resume]');
  if(open)chooseResponse(open.dataset.qboResponse);else if(resume)attempt(()=>resumeResponse(resume.dataset.qboResume));
});
$('qbo-response-resume').addEventListener('click',()=>attempt(()=>resumeResponse(selectedResponse)));
$('qbo-comparison-previous').addEventListener('click',()=>{comparisonOffset=Math.max(0,comparisonOffset-PAGE);renderComparisonRows(responseResult(responseDetail));});
$('qbo-comparison-next').addEventListener('click',()=>{comparisonOffset+=PAGE;renderComparisonRows(responseResult(responseDetail));});
$('qbo-preview-previous').addEventListener('click',()=>{previewOffset=Math.max(0,previewOffset-PAGE);renderResponsePreview();});
$('qbo-preview-next').addEventListener('click',()=>{previewOffset+=PAGE;renderResponsePreview();});
$('qbo-clear-preview').addEventListener('click',()=>{invalidateResponse();showView('response');});
$('qbo-apply').addEventListener('click',()=>attempt(async()=>{
  if(!responsePreview||responsePreview.planId!==selected||!receivable())throw new Error('Preview the received response against this reviewed journal before saving.');
  const intent=responsePreview;
  await perform({path:base()+'/responses',body:intent.request,description:'QuickBooks response and accountant return',message:intent.value.result.kind==='FAULT'?'The received QuickBooks fault is retained for review.':'The saved QuickBooks journal is linked to the original accountant return.',success:async result=>{
    selectedResponse=result.response?.id??intent.request.id;invalidateResponse();loadedFile=null;++fileToken;fileLoading=false;$('qbo-response-file').value='';$('qbo-response-name').value='';$('qbo-file-status').textContent='Choose the complete received JSON file.';showView(intent.value.result.kind==='FAULT'?'response':'return');
  }});
}));
$('qbo-retry').addEventListener('click',()=>{if(pending)attempt(()=>perform(pending,true));});
$('qbo-dismiss-retry').addEventListener('click',()=>{
  pending=null;$('qbo-retry-panel').hidden=true;invalidatePlan();invalidateResponse();invalidateNative();notify('The form is retained. Refresh saved state before creating another operation.');controls();
});
window.addEventListener('beforeunload',()=>{if(previewUrl)URL.revokeObjectURL(previewUrl);});
renderCompany();renderConnection();controls();attempt(()=>reading(refresh));
