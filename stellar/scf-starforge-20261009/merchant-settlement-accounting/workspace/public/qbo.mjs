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
const PAGE=50,MAX_ROWS=500,MAX_RESPONSE_BYTES=8*1024*1024;
const query=new URLSearchParams(location.search);
let metadata=null,revision=0,busy=false,pending=null,refreshToken=0,detailToken=0,sourceToken=0,fileToken=0,responseToken=0;
let selected=query.get('plan')||'',detail=null,source=null,sourceChoice='',currentAccountant=null;
let selectedResponse=query.get('response')||'',responseDetail=null,planLimit=24,lineOffset=0,lineIndex=-1,draftOffset=0,comparisonOffset=0,previewOffset=0;
let draftRows=new Map(),draftSelected=new Set(),sourceDrafts=new Map(),planPreview=null,responsePreview=null,loadedFile=null,fileLoading=false,previewUrl='',loadedCompany=null;
const identity=()=>({id:crypto.randomUUID(),createdAt:new Date().toISOString()});
let createIdentity=identity();
const base=()=>'/api/qbo/plans/'+encode(selected);
const cancelled=()=>detail?.record?.status==='CANCELLED';
const approved=()=>!cancelled()&&(Boolean(detail?.record?.review)||['REVIEWED','BOOKED'].includes(detail?.record?.status));
const resumable=item=>responseRecord(item)?.status==='PENDING'&&!cancelled();
const cancellable=()=>Boolean(detail)&&!['BOOKED','CANCELLED'].includes(detail.record.status)&&!responses().some(item=>responseRecord(item).status==='PENDING');
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
  $('qbo-create').disabled=!writable||!source||!draftSelected.size;
  $('qbo-retain-plan').disabled=!writable||!planPreview;
  $('qbo-clear-plan-preview').disabled=busy;
  $('qbo-review').disabled=!writable||!detail||approved()||cancelled();
  $('qbo-cancel').disabled=!writable||!cancellable();
  $('qbo-company-load').disabled=!writable;$('qbo-company-manual').disabled=!writable||!loadedCompany;
  $('qbo-response-resume').disabled=!writable||!resumable(responseDetail);
  document.querySelectorAll('[data-qbo-resume]').forEach(button=>{button.disabled=!writable||cancelled();});
  $('qbo-import').disabled=!writable||!detail||!approved()||fileLoading||!loadedFile;
  $('qbo-apply').disabled=!writable||!responsePreview||cancelled();
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
  for(const form of ['qbo-create-form','qbo-review-form','qbo-response-form','qbo-company-form','qbo-cancel-form'])for(const input of $(form).querySelectorAll('input,select,textarea'))if(!input.closest('#qbo-mappings'))input.disabled=busy||Boolean(pending)||((form==='qbo-response-form'||form==='qbo-review-form')&&cancelled());
  $('qbo-operator').disabled=busy||Boolean(pending);
  document.body.classList.toggle('working',busy);
}
function invalidatePlan(){planPreview=null;createIdentity=identity();$('qbo-plan-preview-panel').hidden=true;controls();}
function invalidateResponse(){
  responsePreview=null;++responseToken;previewOffset=0;$('qbo-preview-panel').hidden=true;$('qbo-return-empty').hidden=false;
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
    await refresh();notify(intent.message||'Saved to the original accounting workspace.');
  }catch(error){
    if(received)notify('The operation was saved, but its updated view could not be loaded. Refresh saved state to reopen it. '+error.message,true);
    else if(error.status===409){
      pending=null;$('qbo-retry-panel').hidden=true;invalidatePlan();invalidateResponse();
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
  $('qbo-plan-list').innerHTML=plans.slice(0,planLimit).map(row=>'<button type="button" data-qbo-plan="'+esc(row.id)+'"'+(selected===row.id?' class="selected" aria-current="true"':'')+'><strong>'+esc(row.name)+'</strong><span>'+esc(row.companyName??row.realmId??'')+' · '+esc(row.environment??'')+'</span><span>'+esc(date(row.createdAt))+' · '+esc(row.status??'DRAFT')+'</span></button>').join('')||'<p class="hint">No retained plans match this search.</p>';
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
  $('qbo-plan-status').textContent=cancelled()?'Plan cancelled':r.status==='BOOKED'?'Accountant return saved':approved()?'Journal approved':'Awaiting journal review';
  $('qbo-metrics').innerHTML=metrics(summaryMetrics(p));
  $('qbo-company-summary').innerHTML='<p><strong>'+esc(p.companyName)+'</strong> · Company '+esc(p.realmId)+' · '+esc(p.baseCurrency)+' · '+esc(p.environment)+'</p><p class="hint">Journal date '+esc(p.txnDate)+(p.docNumber?' · Document '+esc(p.docNumber):'')+'</p>';
  $('qbo-lineage').innerHTML=definitions({handoffId:p.handoffId,handoffSha256:p.handoffSha256,accountantVersion:p.accountantRevisionId??'Original handoff',planId:p.id,planSha256:p.integrity.sha256,companyId:p.realmId,homeCurrency:p.baseCurrency,environment:p.environment});
  $('qbo-journal-description').textContent=planRows(p).length+' selected source events, with a debit and credit retained for each event.';$('qbo-balance-status').textContent='Balanced per source event';
  renderIssues($('qbo-plan-issues'),p.issues);$('qbo-request-json').textContent=JSON.stringify(journal(p),null,2);
  $('qbo-request-downloads').innerHTML=[...(approved()?[download('journal-entry.json','QuickBooks journal request')]:[]),download('plan.json','Complete plan JSON'),download('accountant.csv','Source-linked accountant CSV'),download('review.html','Offline journal review')].join('');
  $('qbo-review-form').hidden=approved()||cancelled();
  $('qbo-cancel-form').hidden=!cancellable();
  $('qbo-cancel-status').textContent=cancelled()?'This plan is cancelled. Create a new journal plan to use these source events.':r.status==='BOOKED'?'The journal is linked to a saved accountant return. Its retained history remains available.':responses().some(item=>responseRecord(item).status==='PENDING')?'Complete the pending accountant return before changing this plan.':'Cancel this retained plan when it will not be used. Its source events become available for a new journal plan.';
  $('qbo-review-status').textContent=cancelled()?'Cancelled plans retain their saved source and history.':r.review?'Approved by '+r.review.actor+' · '+date(r.review.createdAt):'Approve the retained source, amounts and accounts to enable the journal request download.';
  renderLines();renderResponses();renderFiles();controls();
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
  if(reset){detail=null;currentAccountant=null;selectedResponse='';responseDetail=null;loadedFile=null;fileLoading=false;++fileToken;invalidateResponse();$('qbo-response-file').value='';$('qbo-response-name').value='';$('qbo-file-status').textContent='Choose the complete received JSON file.';lineOffset=0;lineIndex=-1;comparisonOffset=0;showView('journal');}
  renderHistory();if(!id){detail=null;renderPlan();remember();return;}
  const value=await api('/api/qbo/plans/'+encode(id));if(token!==detailToken||id!==selected)return;
  detail=value;const accountant=await api('/api/accountant/handoffs/'+encode(value.plan.handoffId));if(token!==detailToken||id!==selected)return;
  currentAccountant=accountant;renderPlan();renderAccountant();$('qbo-prepare-panel').open=false;remember();
}
async function refresh(){
  const token=++refreshToken,value=await api('/api/qbo');if(token!==refreshToken)return;metadata=value;
  const wanted=sourceChoice||query.get('handoff')||$('qbo-handoff').value;
  options($('qbo-handoff'),value.handoffs?.length?value.handoffs.map(h=>[h.id,h.name+' · '+h.rowCount+' events']):[['','Prepare an accountant handoff first']],wanted);
  renderHistory();if(selected&&value.plans?.some(p=>p.id===selected))await selectPlan(selected,{reset:false});else if(selected){selected='';detail=null;renderPlan();remember();}
  await loadSource({force:true});
  if(planPreview&&planPreview.request.revision!==revision){invalidatePlan();notify('Saved state changed. Your mappings are retained; preview them against the current state.');}
  if(responsePreview&&(responsePreview.request.revision!==revision||responsePreview.request.expectedParentId!==(detail?.expectedParentId??null))){invalidateResponse();notify('The saved accountant state changed. Preview the retained response again to compare its current version.');}
  controls();
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
  if(!detail||!loadedFile||!approved())throw new Error('Choose an approved saved journal plan and its complete QuickBooks response.');
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
  const usable=accounts.filter(a=>a.selectable===true).length,unavailable=accounts.filter(a=>a.selectable!==true);
  $('qbo-company-source-status').innerHTML='<p><strong>Loaded '+esc(company.companyName)+'</strong> · Company '+esc(company.realmId)+' · Home currency '+esc(company.baseCurrency)+' · '+usable+' selectable accounts</p><p class="hint">Choose an exported account ID in each mapping field. Existing account entries remain as entered.</p><details><summary>Company source and unavailable accounts</summary><dl class="record-values">'+definitions({sourceDigests:company.sourceDigests,companySha256:company.integrity?.sha256,multiCurrencyEnabled:company.multiCurrencyEnabled})+'</dl>'+ (unavailable.length?'<p class="hint">'+unavailable.length+' unavailable accounts</p><ul>'+unavailable.map(a=>'<li>'+esc((a.name??a.value)+' · '+a.value+' · '+(Array.isArray(a.reasons)?a.reasons.join('; '):exact(a.reasons??'Unavailable')) )+'</li>').join('')+'</ul>':'<p>All supplied accounts are selectable.</p>')+'</details>';
}
function useManualCompany({message=true}={}){
  loadedCompany=null;renderCompany();invalidatePlan();if(message)notify('Company and account fields remain available for manual entry.');
}
function accountName(value){return loadedCompany?.accounts?.find(a=>a.value===value&&a.selectable===true)?.name??'';}
async function readJsonFile(file,label){
  if(!file)throw new Error('Choose the '+label+' JSON file.');
  if(file.size===0||file.size>MAX_RESPONSE_BYTES)throw new Error(label+' must contain a JSON object and be no larger than 8 MiB.');
  const content=await file.text();let value;
  try{value=JSON.parse(content);}catch{throw new Error(label+' is not valid JSON. Choose the complete original export.');}
  if(!value||typeof value!=='object'||Array.isArray(value))throw new Error(label+' must contain a JSON object.');
  return content;
}
async function loadCompany(){
  await reading(async()=>{
    const realmId=$('qbo-company-realm').value.trim();
    if(!realmId)throw new Error('Enter the company ID for these saved exports.');
    const files=[$('qbo-company-info-file').files[0],$('qbo-company-preferences-file').files[0],$('qbo-company-accounts-file').files[0]];
    const [companyInfo,preferences,accounts]=await Promise.all(files.map((file,index)=>readJsonFile(file,['CompanyInfo','Preferences','Account'][index])));
    const value=await api('/api/qbo/company/preview',{realmId,companyInfo,preferences,accounts});
    if(!value.company)throw new Error('The workspace did not return a company setup.');
    loadedCompany=value.company;$('qbo-realm').value=loadedCompany.realmId;$('qbo-company-name').value=loadedCompany.companyName;$('qbo-currency').value=loadedCompany.baseCurrency;
    renderCompany();invalidatePlan();renderDraftRows();notify('Loaded the company home currency and exported account choices.');
  });
}
async function resumeResponse(id){
  const record=responses().map(responseRecord).find(item=>item.id===id);
  if(!record||!resumable(record))throw new Error('Choose a retained response with a pending accountant return.');
  return perform({path:base()+'/responses/'+encode(id)+'/resume',body:{revision,actor:operator()},description:'saved accountant return',message:'The saved response has been reconciled with its original accountant return.',success:async()=>{selectedResponse=id;invalidateResponse();showView('return');}});
}

$('qbo-date').value=new Date().toISOString().slice(0,10);
$('qbo-company-form').addEventListener('submit',event=>{event.preventDefault();attempt(loadCompany);});
$('qbo-company-manual').addEventListener('click',()=>useManualCompany());
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
    await perform({path:base()+'/review',body,description:'journal approval',message:'The reviewed journal request is available to download.'});
  });
});
$('qbo-cancel-form').addEventListener('submit',event=>{
  event.preventDefault();attempt(async()=>{
    if(!cancellable())throw new Error('This journal plan cannot be cancelled in its current saved state.');
    const body={id:crypto.randomUUID(),revision,actor:operator(),note:$('qbo-cancel-note').value.trim(),planSha256:detail.plan.integrity.sha256,unusedConfirmed:$('qbo-cancel-unused').checked};
    if(!body.note||!body.unusedConfirmed)throw new Error('Enter a cancellation note and confirm the journal has not been used.');
    await perform({path:base()+'/cancel',body,description:'unused journal cancellation',message:'The unused journal plan is cancelled. Its source events are available for a new plan.',success:async()=>{invalidateResponse();$('qbo-cancel-unused').checked=false;}});
  });
});
$('qbo-handoff').addEventListener('change',()=>attempt(()=>reading(()=>loadSource())));
$('qbo-operator').addEventListener('input',()=>{invalidatePlan();invalidateResponse();});
$('qbo-create-form').addEventListener('input',event=>{
  const input=event.target;
  if(input.id==='qbo-draft-search'||input.id.startsWith('qbo-default-')||input.matches('[data-qbo-selected]'))return;
  if(input.id==='qbo-name')input.dataset.dirty='true';
  if(['qbo-realm','qbo-company-name','qbo-currency'].includes(input.id)&&loadedCompany)useManualCompany({message:false});
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
  if(!responsePreview||responsePreview.planId!==selected||cancelled())throw new Error('Preview the received response against this journal before saving.');
  const intent=responsePreview;
  await perform({path:base()+'/responses',body:intent.request,description:'QuickBooks response and accountant return',message:intent.value.result.kind==='FAULT'?'The received QuickBooks fault is retained for review.':'The saved QuickBooks journal is linked to the original accountant return.',success:async result=>{
    selectedResponse=result.response?.id??intent.request.id;invalidateResponse();loadedFile=null;++fileToken;fileLoading=false;$('qbo-response-file').value='';$('qbo-response-name').value='';$('qbo-file-status').textContent='Choose the complete received JSON file.';showView(intent.value.result.kind==='FAULT'?'response':'return');
  }});
}));
$('qbo-retry').addEventListener('click',()=>{if(pending)attempt(()=>perform(pending,true));});
$('qbo-dismiss-retry').addEventListener('click',()=>{
  pending=null;$('qbo-retry-panel').hidden=true;invalidatePlan();invalidateResponse();notify('The form is retained. Refresh saved state before creating another operation.');controls();
});
window.addEventListener('beforeunload',()=>{if(previewUrl)URL.revokeObjectURL(previewUrl);});
renderCompany();controls();attempt(()=>reading(refresh));
