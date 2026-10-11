const byId=id=>document.getElementById(id);
const PAGE_SIZE=50,CASEBOOK_LIMIT=262144,SNAPSHOT_LIMIT=4194304;
const NL=String.fromCharCode(10);
let report=null,catalogue=null,comparison=null,detail=null,selectedCase=null;
let filter='all',page=0,busy=false,casebook=null,casebookPreview=null,removeTarget=null;
const drafts=new Map();
const safe=value=>String(value??'').replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c])).replaceAll(String.fromCharCode(34),'&quot;').replaceAll(String.fromCharCode(39),'&#39;');
const text=(id,value)=>{byId(id).textContent=String(value??'—');};
const title=value=>String(value??'').toLowerCase().split('_').map(x=>x?x[0].toUpperCase()+x.slice(1):'').join(' ');
const utc=value=>{const date=new Date(value);return Number.isFinite(date.getTime())?date.toISOString().replace('T',' ').replace('.000Z',' UTC'):String(value||'—');};
const sourceName=value=>['fixture','fictional example'].includes(value)?'Fictional example':value==='PayPal sandbox read-only API'?'PayPal sandbox':String(value||'Unknown source');
const byteSize=value=>{const n=Number(value);if(!Number.isFinite(n))return '—';return n>=1048576?`${(n/1048576).toFixed(1)} MiB`:n>=1024?`${(n/1024).toFixed(1)} KiB`:`${n} bytes`;};
const filename=value=>String(value??'observation').replace(/[^a-z0-9_.-]+/gi,'-').slice(0,100);
const reviewState=item=>report?.cases?.[item.caseId]?.state||'open';
const equalReview=(a,b)=>['state','owner','note'].every(key=>a?.[key]===b?.[key]);
function amountOrder(a,b){
 const minor=item=>{const [whole,decimal='']=String(item.amount).split('.');return BigInt(whole)*(item.currency==='JPY'?1n:100n)+BigInt(item.currency==='JPY'?'0':decimal.padEnd(2,'0'));};
 const left=minor(a),right=minor(b);return left>right?-1:left<right?1:a.itemId.localeCompare(b.itemId);
}
const statePill=state=>`<span class='pill ${state==='escalated'?'dark':state==='open'?'outline':''}'>${safe(title(state))}</span>`;
const statusPill=status=>status==null?`<span class='muted'>Not present</span>`:`<span class='pill ${['FAILED','DENIED','RETURNED','BLOCKED','REFUNDED','REVERSED'].includes(status)?'dark':status==='SUCCESS'?'':'outline'}'>${safe(status)}</span>`;
const flags={
 DUPLICATE_SENDER_ITEM_ID:['Sender reference reused','Another item in this batch uses this sender reference. Check the merchant ledger to establish whether both entries are expected.'],
 NONFINAL_STATUS:['Awaiting final status','The captured provider status remains non-final. Review a later observation before treating this payout as completed.'],
 FAILED_OR_RETURNED:['Unpaid or returned status','The captured provider status is a failed, denied, blocked, returned, refunded or reversed outcome. Review the original item and merchant ledger.'],
 MODEL_NOTE_REVIEW:['Review the payout note','The note resembles this local model’s review examples. Inspect the original wording, item identity and business context.'],
 ORIGINAL_PAYOUT_REGRESSION:['Success changed to another status','The same original item previously showed SUCCESS and now has another observed status. Investigate the change.'],
 UNEXPECTED_FAILED_TO_SUCCESS:['Unpaid status changed to success','A previously unpaid or returned status now shows SUCCESS. Verify the original item and its lifecycle.'],
 SOURCE_AMOUNT_DRIFT:['Source amount changed','The original item amount or currency differs between the two captures.'],
 SOURCE_RECIPIENT_DRIFT:['Source recipient changed','The original recipient value differs between the two captures. The displayed receiver remains masked.'],
 SOURCE_SENDER_ID_DRIFT:['Sender reference changed','The merchant sender item ID differs between the two captures.'],
 SOURCE_NOTE_DRIFT:['Original note changed','The original payout note differs between the two captures.'],
 POST_PAYOUT_REVERSAL:['Refunded or reversed','The later observation shows a refunded or reversed provider status.'],
 ORIGINAL_ITEM_ADDED:['Item added to observation','This item is present only in the later capture.'],
 ORIGINAL_ITEM_REMOVED:['Item absent from later observation','This original item is absent from the later capture.'],
 UNRESOLVED_STALLED:['Unresolved status persisted','The same non-final status is present in both captures, separated by at least the selected stalled threshold.'],
 BATCH_AMOUNT_OR_CURRENCY_CHANGED:['Batch amount or currency changed','The declared aggregate differs between observations.'],
 BATCH_AGGREGATE_UNCONFIRMED:['Batch aggregate needs review','At least one capture does not have a confirmed matching aggregate.'],
 SOURCE_ITEM_SET_CHANGED:['Observed item set changed','Items were added or absent between captures.']
};
function flagLabel(code){return flags[code]?.[0]||title(code);}
function node(tag,value,className){const el=document.createElement(tag);if(value!==undefined)el.textContent=String(value);if(className)el.className=className;return el;}
function factsInto(id,entries){byId(id).replaceChildren(...entries.map(([key,value])=>{const wrap=node('div');wrap.append(node('dt',key),node('dd',value??'—'));return wrap;}));}
function notice(message='',tone='info'){const el=byId('alert');el.hidden=!message;el.dataset.tone=tone;el.textContent=message;}
function inlineError(id,message=''){text(id,message);byId(id).hidden=!message;}
async function api(path,method='GET',body){
 let response;
 try{response=await fetch(path,{method,headers:body!==undefined?{'Content-Type':'application/json'}:{},body:body!==undefined?JSON.stringify(body):undefined});}
 catch(error){error.requestMethod=method;throw error;}
 let value;
 try{value=await response.json();}
 catch{
  const error=new Error(`HTTP ${response.status}: the server response was not readable JSON.`);
  error.status=response.status;error.unreadableResponse=true;error.requestMethod=method;throw error;
 }
 if(!response.ok){const error=new Error(value?.error||`HTTP ${response.status}`);error.status=response.status;error.requestMethod=method;throw error;}
 return value;
}
function activeQuery(){return new URLSearchParams({observationId:report.observationId,version:String(report.version)}).toString();}
function saveBlob(blob,name){const href=URL.createObjectURL(blob),link=node('a');link.href=href;link.download=name;document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(href),1000);}
function saveJSON(value,name){saveBlob(new Blob([JSON.stringify(value,null,2)+NL],{type:'application/json'}),name);}
async function download(path,name){const response=await fetch(path);if(!response.ok){const value=await response.json().catch(()=>({}));const error=new Error(value.error||`Download failed: HTTP ${response.status}`);error.status=response.status;throw error;}saveBlob(await response.blob(),name);}
function currentDraft(){return {state:byId('triageState').value,owner:byId('triageOwner').value,note:byId('triageNote').value};}
function draftKey(value=detail){return value?`${value.observationId}:${value.item.caseId}`:null;}
function storedReview(value=detail){return {state:value?.review?.state||'open',owner:value?.review?.owner||'',note:value?.review?.note||''};}
function draftChanged(){return !!detail&&!equalReview(currentDraft(),storedReview());}
function rememberDraft(){if(!detail||!byId('itemDialog').open)return;const key=draftKey();if(draftChanged())drafts.set(key,currentDraft());else drafts.delete(key);syncControls();}
function sameDetail(){return !!detail&&detail.observationId===report?.observationId&&detail.item.caseId===selectedCase;}
function syncControls(){
 const ready=!!report,items=catalogue?.observations||[];
 for(const id of ['refreshReport','closeItem','cancelRemove'])byId(id).disabled=false;
 for(const id of ['sync','demo','snapshotImport','batchId'])byId(id).disabled=busy||!ready;
 byId('sync').disabled=busy||!ready||!byId('batchId').value.trim();
 for(const id of ['export','observationExport','casebookExport','casebookImport','search','sort'])byId(id).disabled=busy||!ready;
 byId('observationSelect').disabled=busy||!items.length;
 byId('selectObservation').disabled=busy||!ready||!byId('observationSelect').value||byId('observationSelect').value===report?.observationId;
 byId('removeObservation').disabled=busy||!ready||items.length<2;
 for(const id of ['baseline','followup','staleHours'])byId(id).disabled=busy||items.length<2;
 byId('compare').disabled=busy||items.length<2;
 for(const id of ['comparisonJSON','comparisonCSV','comparisonHTML'])byId(id).disabled=busy||!comparison;
 for(const button of document.querySelectorAll('[data-filter],[data-open-case],[data-compare-source]'))button.disabled=busy||!ready;
 byId('previousPage').disabled=busy||page===0;
 byId('nextPage').disabled=busy||(page+1)*PAGE_SIZE>=visibleItems().length;
 byId('casebookRestore').disabled=busy||!casebookPreview?.changes?.length;
 byId('casebookCancel').disabled=busy;
 for(const id of ['triageState','triageOwner','triageNote'])byId(id).disabled=busy||!sameDetail();
 byId('saveTriage').disabled=busy||!sameDetail()||!draftChanged();
 byId('reopenTriage').disabled=busy||!sameDetail()||detail.review?.state==='open';
 byId('caseExport').disabled=busy||!sameDetail();
 byId('confirmRemove').disabled=busy||!removeTarget;
 byId('refreshReport').disabled=busy;
 byId('main').setAttribute('aria-busy',String(busy));
 byId('detailBody').setAttribute('aria-busy',String(busy));
}
function setBusy(value,message='Working…'){busy=value;byId('working').hidden=!value;text('working',message);syncControls();}
async function perform(label,work,{reload=true,mutates=reload,success='',errorId=null}={}){
 if(busy)return null;setBusy(true,label);notice('');if(errorId)inlineError(errorId);
 let accepted=false,result;
 try{result=await work();accepted=true;if(reload)await loadContext();if(success)notice(typeof success==='function'?success(result):success);return result;}
 catch(error){
  let message=accepted?`${label} completed, but the workspace could not be refreshed: ${error.message}`:error.message;
  const uncertain=mutates&&(error.status==null||error.status>=500||error.unreadableResponse);
  if(error.status===409||uncertain){
   try{await loadContext();message+=' The current workspace was refreshed; review its current saved state before continuing.';}
   catch{message+=' The current workspace could not be refreshed. Use Refresh workspace before continuing.';}
  }
  notice(message,'error');if(errorId)inlineError(errorId,message);return accepted?result:null;
 }
 finally{setBusy(false);}
}
function populateSelect(id,observations,selected){
 const el=byId(id);el.replaceChildren(...observations.map(observation=>{const option=node('option',`${observation.batchId} · ${utc(observation.capturedAt)} · ${sourceName(observation.source)} · ${observation.itemCount} items`);option.value=observation.id;return option;}));
 if(observations.some(value=>value.id===selected))el.value=selected;
}
function renderObservations(){
 const observations=catalogue?.observations||[];
 const ordered=[...observations].sort((a,b)=>Date.parse(a.capturedAt)-Date.parse(b.capturedAt)||a.id.localeCompare(b.id));
 const oldFrom=byId('baseline').value,oldTo=byId('followup').value;
 populateSelect('observationSelect',[...ordered].reverse(),report.observationId);
 const selected=observations.find(x=>x.id===report.observationId);
 const compatible=ordered.filter(x=>x.batchId===selected?.batchId&&x.source===selected?.source);
 let from=oldFrom,to=oldTo;
 if(!ordered.some(x=>x.id===from)||!ordered.some(x=>x.id===to)||from===to){
  const index=compatible.findIndex(x=>x.id===selected?.id);
  if(index>0){from=compatible[index-1].id;to=compatible[index].id;}
  else if(compatible.length>1){from=compatible[0].id;to=compatible[1].id;}
  else{from=ordered[0]?.id;to=ordered[1]?.id||ordered[0]?.id;}
 }
 populateSelect('baseline',ordered,from);populateSelect('followup',ordered,to);
 const storage=report.storage||catalogue.storage||{};
 const storageError=typeof storage.lastError==='string'?storage.lastError:'';
 text('storageStatus',storageError?'Storage needs attention':storage.mode==='persistent'?'Saved workspace':'Memory session');
 text('observationStatus',`${observations.length} retained observation${observations.length===1?'':'s'}. ${storageError?`Last storage error: ${storageError}`:storage.mode==='persistent'?'Observations and local review survive a restart.':'This session is held in memory.'}`);
 text('storageCapacity',`${storage.observationCount??observations.length} / ${storage.maxObservations??128} observations · ${byteSize(storage.bytes)} / ${byteSize(storage.maxBytes??67108864)}${storage.savedAt?` · Saved ${utc(storage.savedAt)}`:''}`);
}
function visibleItems(){
 if(!report)return [];
 const query=byId('search').value.trim().toLowerCase();
 const items=report.items.filter(item=>(filter==='all'||(filter==='review'?item.flags.length>0:reviewState(item)===filter))&&(!query||[item.itemId,item.senderItemId,item.receiver,item.note].some(value=>String(value).toLowerCase().includes(query))));
 const sort=byId('sort').value;
 const priority=item=>(reviewState(item)==='escalated'?100:0)+(reviewState(item)==='open'?20:0)+(item.severity==='high'?10:item.flags.length?5:0);
 items.sort(sort==='amount'?amountOrder:sort==='item'?(a,b)=>a.itemId.localeCompare(b.itemId):(a,b)=>priority(b)-priority(a)||a.itemId.localeCompare(b.itemId));
 return items;
}
function renderRows(){
 const visible=visibleItems();page=Math.min(page,Math.max(0,Math.ceil(visible.length/PAGE_SIZE)-1));
 const current=visible.slice(page*PAGE_SIZE,(page+1)*PAGE_SIZE);
 text('counter',`(${visible.length} / ${report?.items.length||0})`);
 byId('rows').innerHTML=current.length?current.map(item=>{
  const state=reviewState(item),review=report.cases[item.caseId];
  const labels=item.flags.map(flagLabel);
  const model=item.signals||{},score=Number(model.reviewProbability);
  return `<tr><td><strong>${safe(item.itemId)}</strong><small>${safe(item.receiver)} · ${safe(item.senderItemId||'No sender reference')}</small><div class='row-note'>${safe(item.note.slice(0,90))}${item.note.length>90?'…':''}</div></td><td><strong>${safe(item.currency)} ${safe(item.amount)}</strong></td><td>${statusPill(item.status)}</td><td><div>${safe(labels.slice(0,2).join(' · ')||'No current rule or model flags')}${labels.length>2?` +${labels.length-2}`:''}</div><small>${Number.isFinite(score)?`Note score ${(score*100).toFixed(0)}%${model.knownTokens===0?' · No known terms':''}`:'Note score unavailable'}</small></td><td>${statePill(state)}${review?.owner?`<small>${safe(review.owner)}</small>`:''}</td><td><button type='button' class='row-action' data-open-case='${safe(item.caseId)}' aria-label='Open review for ${safe(item.itemId)}'>Open review</button></td></tr>`;
 }).join(''):`<tr><td colspan='6' class='empty'>${report?.items.length?'No payouts match these filters. Try All or clear the search.':'This observation contains no payout items.'}</td></tr>`;
 text('pageStatus',visible.length?`Showing ${page*PAGE_SIZE+1}–${Math.min((page+1)*PAGE_SIZE,visible.length)} of ${visible.length} payouts`:'No matching payouts');
 syncControls();
}
function render(){
 if(!report)return;
 text('source',sourceName(report.source));text('batch',report.id);text('capturedAt',utc(report.observedAt));text('batchStatus',report.status);text('reviewVersion',`Version ${report.version}`);
 text('items',report.totals.count);text('amount',`${report.totals.currency} ${report.totals.itemSum}`);
 text('balanced',report.totals.match===true?'Matches provider batch amount':report.totals.match===false?`Differs from provider amount ${report.totals.declaredBatch}`:'Provider aggregate not present');
 text('flags',report.items.filter(item=>item.flags.length).length);text('pending',report.totals.unresolved);
 const counts={open:0,acknowledged:0,escalated:0};for(const item of report.items)counts[reviewState(item)]++;
 text('reviewCount',`${counts.open} open · ${counts.escalated} escalated · ${counts.acknowledged} acknowledged`);
 text('casebookStatus',`Review states are bound to this observation. Download the state-only casebook to restore decisions; the payout CSV includes assigned operators and notes.`);
 factsInto('provenanceFields',[['Observation',report.observationId],['Source',sourceName(report.source)],['Captured at',utc(report.observedAt)],['Evidence SHA-256',report.evidenceHash],['Model',report.model],['Source amount',report.totals.declaredBatch==null?'Not reported':`${report.totals.currency} ${report.totals.declaredBatch}`]]);
 text('limitations',`The local note model uses example training notes and suggests review attention. Provider fields are captured observations. ${report.source==='fictional example'||report.source==='fixture'?'This workspace currently displays the fictional example dataset.':''}`);
 renderObservations();renderRows();
}
async function loadContext({reloadDetail=true}={}){
 rememberDraft();
 const [next,list]=await Promise.all([api('/api/report'),api('/api/observations')]);
 if(casebookPreview&&(next.version!==casebookPreview.currentVersion||next.evidenceHash!==casebookPreview.evidenceHash||next.source!==casebookPreview.source))clearPreview('Workspace changed. Reopen the casebook to prepare a fresh restore preview.');
 report=next;catalogue=list;render();
 if(reloadDetail&&byId('itemDialog').open&&selectedCase){
  if(detail?.observationId&&detail.observationId!==report.observationId){inlineError('triageError','Another observation is now open in the workspace. Your draft is retained; close this panel and reopen the intended observation before saving.');syncControls();return;}
  const nextDetail=await api(`/api/cases/${encodeURIComponent(selectedCase)}?${activeQuery()}`);
  if(nextDetail.observationId!==report.observationId)throw new Error('The active observation changed while opening this case. Refresh the workspace.');
  detail=nextDetail;renderDetail();
 }
}
let comparisonContext=null;
function renderOriginalNote(fullNote,scoredNote,signals){
 const target=byId('detailNote');target.replaceChildren();
 if(!fullNote){target.append(node('span','No payout note was supplied.'));return;}
 if(!fullNote.startsWith(scoredNote)){target.textContent=fullNote;return;}
 const known=new Set(signals.map(value=>String(value.token).toLowerCase()));
 let index=0;
 for(const match of scoredNote.matchAll(/[a-z][a-z0-9]{1,24}/gi)){
  target.append(document.createTextNode(scoredNote.slice(index,match.index)));
  if(known.has(match[0].toLowerCase())){const mark=node('mark',match[0]);mark.dataset.token=match[0].toLowerCase();target.append(mark);}
  else target.append(document.createTextNode(match[0]));
  index=match.index+match[0].length;
 }
 target.append(document.createTextNode(scoredNote.slice(index)+fullNote.slice(scoredNote.length)));
}
function renderDetail(){
 if(!detail)return;
 const item=detail.item,review=storedReview(),model=item.signals||{},record=detail.sourceRecord||{};
 text('detailHeading',item.itemId);text('detailSource',`${sourceName(report.source)} · Captured ${utc(report.observedAt)}`);
 text('detailSender',`${item.receiver} · Sender reference ${item.senderItemId||'not supplied'}`);
 text('detailAmount',`${item.currency} ${item.amount}`);byId('detailStatus').innerHTML=statusPill(item.status);byId('detailReview').innerHTML=statePill(review.state);
 const findings=item.flags.map(code=>({code,comparison:false}));
 if(comparisonContext?.row?.caseId===item.caseId){for(const code of comparisonContext.row.flags){if(!item.flags.includes(code))findings.push({code,comparison:true});}}
 byId('detailFlags').replaceChildren(...findings.map(({code,comparison:fromComparison})=>{const li=node('li');li.append(node('strong',`${fromComparison?'Comparison · ':''}${flagLabel(code)}`),node('span',flags[code]?.[1]||code));return li;}));
 if(!findings.length){const li=node('li');li.append(node('strong','No current rule or model flags'),node('span','Inspect the original fields and record the review decision appropriate to the merchant ledger.'));byId('detailFlags').append(li);}
 if(comparisonContext?.row?.caseId===item.caseId){const row=comparisonContext.row,li=node('li');li.append(node('strong',`Observed lifecycle: ${row.beforeStatus||'not present'} → ${row.afterStatus||'not present'}`),node('span',`${utc(comparisonContext.baselineAt)} to ${utc(comparisonContext.followupAt)} · ${comparisonContext.elapsedHours} hours apart.`));byId('detailFlags').prepend(li);}
 const probability=Number(model.reviewProbability),available=Number.isFinite(probability);
 text('modelName',`${model.trainedExamples??'—'} example training notes · Local Naive Bayes model`);
 text('modelLabel',model.knownTokens===0?'No known terms':model.label==='review'?'Review suggested':'Routine wording');
 text('modelProbability',available?`${(probability*100).toFixed(1)}%`:'Unavailable');
 byId('modelMeter').hidden=!available;byId('modelMeter').value=available?probability:0;
 text('modelMeaning',model.knownTokens===0?'No words matched the training vocabulary, so this score reflects the model’s prior. Use the source fields and merchant context.':`${model.knownTokens} known word occurrences contributed. This is a text-pattern score, not a probability of fraud or payment failure.`);
 const signals=Array.isArray(model.topSignals)?model.topSignals:[];
 byId('modelSignals').replaceChildren(...signals.map(signal=>{
  const lift=Number(signal.reviewLift),li=node('li'),button=node('button',signal.token),caption=node('span');
  button.type='button';button.dataset.noteTerm=signal.token;button.title='Find this term in the original note';
  caption.append(node('strong',lift>0?'Toward review':lift<0?'Toward routine':'Neutral term'),node('small',`Contribution ${lift>0?'+':''}${lift.toFixed(3)}`));
  li.title='Per-occurrence contribution to the model’s review-versus-routine log odds.';li.append(button,caption);return li;
 }));
 if(!signals.length)byId('modelSignals').append(node('li','No known terms contributed to this score.'));
 const fullNote=String(record.note??item.note??''),scoredNote=String(record.scoredNote??item.note??'');
 renderOriginalNote(fullNote,scoredNote,signals);
 text('noteScope',`Source: payout_item.note. ${fullNote===scoredNote?'The model scored the displayed note.':`The full original note is shown; the model scored its first ${scoredNote.length} characters.`} Highlighted terms link to the contributions above.`);
 const pendingDraft=drafts.get(draftKey());
 if(pendingDraft&&equalReview(pendingDraft,review))drafts.delete(draftKey());
 const values=drafts.get(draftKey())||review;
 byId('triageState').value=values.state;byId('triageOwner').value=values.owner;byId('triageNote').value=values.note;
 text('triageStatus',drafts.has(draftKey())?'Unsaved draft retained.':detail.review?.changedAt?`Saved ${utc(detail.review.changedAt)}`:'No local decision saved yet.');
 const history=Array.isArray(detail.history)?detail.history:[];
 byId('detailAudit').replaceChildren(...history.slice(-10).reverse().map(event=>{const li=node('li');li.append(node('strong',`${title(event.from||'open')} → ${title(event.to||event.state||'open')}`),node('small',`${utc(event.at)}${event.owner?` · ${event.owner}`:''}${event.via==='casebook_import'?' · Casebook restore':''}`));if(event.note)li.append(node('p',event.note));return li;}));
 if(!history.length)byId('detailAudit').append(node('li','No decisions have been recorded for this item in this observation.'));
 if(history.length>10||detail.historyDropped)byId('detailAudit').append(node('li',`Showing the latest ${Math.min(history.length,10)} retained entries.${detail.historyDropped?` Observation audit window: ${detail.historyDropped} older events omitted across all cases.`:''}`,'helper'));
 factsInto('detailFacts',[['Observation',detail.observationId],['Captured at',utc(report.observedAt)],['Original payout item ID',record.itemId??item.itemId],['Merchant sender item ID',record.senderItemId??item.senderItemId],['transaction_status',record.transactionStatus??item.status],['Receiver · masked',record.receiverMasked??item.receiver],['payout_item.amount',`${item.currency} ${item.amount}`],['Case ID',item.caseId],['Evidence SHA-256',detail.review?.evidenceHash??report.evidenceHash],['Review version',detail.version]]);
 syncControls();
}
async function openCase(caseId,context=null){
 if(busy||!report)return;
 await perform('Opening payout review…',async()=>{
  const expected=report.observationId,next=await api(`/api/cases/${encodeURIComponent(caseId)}?${activeQuery()}`);
  if(next.observationId!==expected||next.item?.caseId!==caseId)throw new Error('The active observation changed. Refresh the workspace and reopen the intended item.');
  selectedCase=caseId;detail=next;comparisonContext=context;inlineError('triageError');renderDetail();
  if(!byId('itemDialog').open)byId('itemDialog').showModal();byId('detailHeading').focus();
 },{reload:false});
}
async function saveTriage(){
 if(busy||!sameDetail())return;
 const key=draftKey(),values=currentDraft(),version=detail.version,caseId=detail.item.caseId;
 drafts.set(key,values);text('triageStatus','Saving review…');
 const result=await perform('Saving review',async()=>{
  const saved=await api('/api/decision','POST',{caseId,version,...values});
  if(detail&&draftKey()===key){detail.review={...detail.review,...values,changedAt:saved.event?.at};detail.version=saved.version;}
  drafts.delete(key);return saved;
 },{errorId:'triageError',success:saved=>`Review saved at workspace version ${saved.version}.`});
 if(result&&detail?.item.caseId===caseId)text('triageStatus',`Saved at version ${result.version}.`);
 else if(!result&&detail?.item.caseId===caseId)text('triageStatus',drafts.has(key)?'Draft retained. Review the current saved state before saving again.':equalReview(storedReview(),values)?`Saved state confirmed${detail.review?.changedAt?` at ${utc(detail.review.changedAt)}`:''}.`:'Current review refreshed.');
}
function clearComparison(message='Choose observations and select Compare.'){comparison=null;comparisonContext=null;byId('comparisonResults').hidden=true;byId('comparisonSource').hidden=true;text('comparisonStatus',message);inlineError('comparisonError');syncControls();}
function renderComparison(){
 if(!comparison)return;
 const value=comparison;
 text('compItems',value.counts.total);text('compChanged',value.counts.statusChanged);text('compStalled',value.counts.stalled);text('compElapsed',value.elapsedHours);
 text('comparisonSource',sourceName(value.source));byId('comparisonSource').hidden=false;
 text('comparisonStatus',`${value.batchId} · ${utc(value.baselineAt)} → ${utc(value.followupAt)} · Stalled threshold ${value.staleHours} hours.`);
 text('batchFlags',value.batchFlags.length?value.batchFlags.map(flagLabel).join(' · '):'Both captures have matching declared aggregates and the same observed item set.');
 byId('comparisonRows').innerHTML=value.rows.map(row=>{
  const sourceButtons=[];
  if(row.beforeStatus!=null)sourceButtons.push(`<button type='button' class='row-action' data-compare-source='earlier' data-compare-observation='${safe(value.baselineId)}' data-case-id='${safe(row.caseId)}' aria-label='Open earlier source for ${safe(row.itemId)}'>Earlier</button>`);
  if(row.afterStatus!=null)sourceButtons.push(`<button type='button' class='row-action' data-compare-source='later' data-compare-observation='${safe(value.followupId)}' data-case-id='${safe(row.caseId)}' aria-label='Open later source for ${safe(row.itemId)}'>Later</button>`);
  return `<tr><td><strong>${safe(row.itemId)}</strong><small>${safe(row.receiverMasked)} · ${safe(row.currency)} ${safe(row.amount)}</small></td><td>${statusPill(row.beforeStatus)}</td><td>${statusPill(row.afterStatus)}</td><td>${safe(row.flags.map(flagLabel).join(' · ')||'No current comparison flags')}${row.statusChanged?`<small>Status changed</small>`:''}</td><td><div class='buttonrow'>${sourceButtons.join('')}</div></td></tr>`;
 }).join('')||`<tr><td colspan='5' class='empty'>No payout items were present in either observation.</td></tr>`;
 text('comparisonProvenance',`Earlier evidence ${value.originalEvidence.baseline.slice(0,12)}… · Later evidence ${value.originalEvidence.followup.slice(0,12)}…`);
 byId('comparisonResults').hidden=false;syncControls();
}
async function runComparison(event){
 event?.preventDefault();if(busy||!report||!byId('comparisonForm').reportValidity())return;
 const from=byId('baseline').value,to=byId('followup').value,staleHours=Number(byId('staleHours').value);
 const a=catalogue.observations.find(x=>x.id===from),b=catalogue.observations.find(x=>x.id===to);
 if(!a||!b||a.id===b.id){inlineError('comparisonError','Choose two different observations.');return;}
 if(a.batchId!==b.batchId||a.source!==b.source){inlineError('comparisonError','Choose captures of the same original batch and source.');return;}
 if(Date.parse(b.capturedAt)<=Date.parse(a.capturedAt)){inlineError('comparisonError','The later observation must have a capture time after the earlier one.');return;}
 const result=await perform('Comparing captured observations…',()=>api(`/api/compare?${new URLSearchParams({from,to,staleHours:String(staleHours)})}`),{reload:false,errorId:'comparisonError'});
 if(result){comparison=result;renderComparison();}
}
async function openComparisonSource(button){
 if(!comparison||busy)return;
 const value=comparison,observationId=button.dataset.compareObservation,caseId=button.dataset.caseId,row=value.rows.find(x=>x.caseId===caseId);
 await perform('Opening captured comparison source…',async()=>{
  if(report.observationId!==observationId){await api('/api/select','POST',{observationId,version:report.version});await loadContext({reloadDetail:false});}
  const next=await api(`/api/cases/${encodeURIComponent(caseId)}?${activeQuery()}`);
  if(next.observationId!==observationId||next.item.caseId!==caseId)throw new Error('The workspace changed while opening this source. Refresh and select it again.');
  detail=next;selectedCase=caseId;comparisonContext={row,baselineAt:value.baselineAt,followupAt:value.followupAt,elapsedHours:value.elapsedHours};
  inlineError('triageError');renderDetail();if(!byId('itemDialog').open)byId('itemDialog').showModal();byId('detailHeading').focus();
 },{reload:false,mutates:true});
}
function exportComparison(format){
 if(!comparison||busy)return;
 const value=comparison;
 const query=new URLSearchParams({from:value.baselineId,to:value.followupId,staleHours:String(value.staleHours),format});
 return perform('Exporting original comparison…',()=>download(`/api/compare?${query}`,`disburselens-comparison-${filename(value.batchId)}.${format}`),{reload:false,success:'Original comparison download started.'});
}
function clearPreview(message=''){
 casebook=null;casebookPreview=null;byId('casebookPreview').hidden=true;byId('casebookChanges').replaceChildren();if(message)text('casebookStatus',message);syncControls();
}
function showPreview(prepared){
 text('casebookSummary',(prepared.legacyFixtureSource?'Legacy fixture casebook matched the original fixture observation. ':'')+(prepared.changes.length?`${prepared.changes.length} review state${prepared.changes.length===1?'':'s'} will change. Saved states: ${prepared.counts.open} open, ${prepared.counts.acknowledged} acknowledged, ${prepared.counts.escalated} escalated.`:'These saved review states already match. No restore is needed.'));
 factsInto('casebookSource',[['Evidence SHA-256',prepared.evidenceHash],['Source',sourceName(prepared.source)],['Saved version',prepared.exportVersion],['Exported at',utc(prepared.exportedAt)],['Current workspace version',prepared.currentVersion],['Operator notes',prepared.annotationsPreserved?'Existing notes and ownership are retained; this file restores review states only.':'This file contains review states only.']]);
 byId('casebookChanges').replaceChildren(...prepared.changes.map(change=>{const li=node('li'),item=report.items.find(x=>x.caseId===change.caseId);li.append(node('code',item?.itemId||change.caseId),node('span',`${title(change.from)} → ${title(change.to)}`));return li;}));
 text('casebookRestore',`Restore ${prepared.changes.length} review state${prepared.changes.length===1?'':'s'}`);byId('casebookPreview').hidden=false;byId('casebookPreviewHeading').focus();syncControls();
}
async function importCasebook(){
 const file=byId('casebookImport').files[0];if(!file||busy||!report)return;
 clearPreview();inlineError('casebookError');
 const prepared=await perform('Preparing casebook restore preview…',async()=>{
  if(file.size>CASEBOOK_LIMIT)throw new Error('Casebook exceeds the 256 KiB limit.');
  const selected=JSON.parse(await file.text()),body={version:report.version,casebook:selected};
  if(new TextEncoder().encode(JSON.stringify(body)).byteLength>CASEBOOK_LIMIT)throw new Error('Casebook request exceeds the 256 KiB limit.');
  const preview=await api('/api/casebook/preview','POST',body);casebook=selected;return preview;
 },{reload:false,errorId:'casebookError'});
 byId('casebookImport').value='';if(prepared){casebookPreview=prepared;showPreview(prepared);text('casebookStatus','Preview ready. Restore applies only the changes listed below.');}
}
async function restoreCasebook(){
 if(busy||!casebook||!casebookPreview?.changes?.length)return;
 const body={version:casebookPreview.currentVersion,casebook};
 const result=await perform('Restoring review states',async()=>{const saved=await api('/api/casebook/restore','POST',body);clearPreview();return saved;},{errorId:'casebookError',success:value=>`Restored ${value.changed} review state${value.changed===1?'':'s'} at version ${value.version}.`});
 if(!result){clearPreview('Reopen the saved casebook to prepare a current preview.');}
}
async function readJSONFile(file,limit,label){
 if(file.size>limit)throw new Error(`${label} exceeds ${byteSize(limit)}.`);
 const content=await file.text();
 if(new TextEncoder().encode(content).byteLength>limit)throw new Error(`${label} exceeds ${byteSize(limit)}.`);
 try{return JSON.parse(content);}catch{throw new Error(`${label} is not valid JSON. Select the original exported JSON file.`);}
}
function previewRemoval(){
 if(busy||!report||(catalogue?.observations.length||0)<2)return;
 const observation=catalogue.observations.find(value=>value.id===report.observationId);
 if(!observation)return;
 removeTarget={...observation,version:report.version};
 factsInto('removeFacts',[['Batch',observation.batchId],['Source',sourceName(observation.source)],['Captured at',utc(observation.capturedAt)],['Payout items',observation.itemCount],['Local review',`${observation.caseCounts?.open??0} open · ${observation.caseCounts?.acknowledged??0} acknowledged · ${observation.caseCounts?.escalated??0} escalated`],['Observation',observation.id]]);
 inlineError('removeError');syncControls();byId('removeDialog').showModal();byId('removeHeading').focus();
}
async function removeObservation(){
 if(busy||!removeTarget)return;
 const target=removeTarget;
 const result=await perform('Removing retained observation',async()=>{
  const removed=await api('/api/observations/remove','POST',{observationId:target.id,version:target.version});
  if(comparison&&(comparison.baselineId===target.id||comparison.followupId===target.id))clearComparison('A compared observation was removed. Choose another retained pair.');
  for(const key of drafts.keys())if(key.startsWith(target.id+':'))drafts.delete(key);
  removeTarget=null;byId('removeDialog').close();return removed;
 },{errorId:'removeError',success:'Observation and its local review removed. The remaining current observation is open.'});
 if(!result&&catalogue&&!catalogue.observations.some(value=>value.id===target.id)){removeTarget=null;byId('removeDialog').close();notice('The observation is no longer retained. The current remaining observation is open.');}
 else if(!result&&removeTarget&&report?.version!==removeTarget.version){text('removeError','The workspace changed. Cancel this preview and review the current observation before removing it.');byId('removeError').hidden=false;removeTarget=null;syncControls();}
}
let lastCaseTrigger=null;
byId('refreshReport').addEventListener('click',()=>perform('Refreshing workspace…',()=>loadContext(),{reload:false,success:'Workspace refreshed.'}));
byId('batchId').addEventListener('input',syncControls);
byId('sync').addEventListener('click',()=>{
 if(busy||!report)return;const batchId=byId('batchId').value.trim();if(!batchId){notice('Enter the original PayPal sandbox batch ID.','error');return;}
 perform('Reading PayPal sandbox batch…',()=>api('/api/sync','POST',{batchId,version:report.version}),{success:'Complete sandbox observation opened.'});
});
byId('demo').addEventListener('click',()=>{if(report)perform('Opening fictional fixture observation…',()=>api('/api/load-demo','POST',{version:report.version}),{success:'Original fictional example observation opened.'});});
byId('observationSelect').addEventListener('change',syncControls);
byId('selectObservation').addEventListener('click',()=>{
 if(!report||busy)return;const observationId=byId('observationSelect').value;
 page=0;perform('Opening retained observation…',()=>api('/api/select','POST',{observationId,version:report.version}),{success:'Retained observation and its saved review opened.'});
});
byId('snapshotImport').addEventListener('change',async()=>{
 const file=byId('snapshotImport').files[0];if(!file||busy||!report)return;
 await perform('Importing original captured observation…',async()=>{
  const snapshot=await readJSONFile(file,SNAPSHOT_LIMIT,'Snapshot'),body={snapshot,version:report.version};
  if(new TextEncoder().encode(JSON.stringify(body)).byteLength>SNAPSHOT_LIMIT)throw new Error('Snapshot request exceeds the 4 MiB limit.');
  page=0;return api('/api/observations/import','POST',body);
 },{success:value=>value.reused?'The identical retained observation is open; its saved review is preserved.':'Original observation imported and opened.'});
 byId('snapshotImport').value='';
});
byId('observationExport').addEventListener('click',()=>{if(report)perform('Exporting original source…',()=>download(`/api/observations/${encodeURIComponent(report.observationId)}.json`,`disburselens-source-${filename(report.id)}-${report.observationId.slice(0,12)}.json`),{reload:false,success:'Original source JSON download started.'});});
byId('removeObservation').addEventListener('click',previewRemoval);
byId('confirmRemove').addEventListener('click',removeObservation);
byId('cancelRemove').addEventListener('click',()=>byId('removeDialog').close());
byId('removeDialog').addEventListener('close',()=>{removeTarget=null;syncControls();});
byId('export').addEventListener('click',()=>{if(report)perform('Exporting payout review…',()=>download(`/api/export.csv?${activeQuery()}`,`disburselens-payouts-${filename(report.id)}-v${report.version}.csv`),{reload:false,success:'Payout CSV download started, including current local review ownership and notes.'});});
for(const button of document.querySelectorAll('[data-filter]'))button.addEventListener('click',()=>{
 if(busy)return;filter=button.dataset.filter;page=0;
 for(const current of document.querySelectorAll('[data-filter]')){const active=current===button;current.classList.toggle('active',active);current.setAttribute('aria-pressed',String(active));}
 renderRows();
});
byId('search').addEventListener('input',()=>{page=0;renderRows();});
byId('sort').addEventListener('change',()=>{page=0;renderRows();});
byId('previousPage').addEventListener('click',()=>{if(!busy&&page>0){page--;renderRows();}});
byId('nextPage').addEventListener('click',()=>{if(!busy){page++;renderRows();}});
byId('rows').addEventListener('click',event=>{const button=event.target.closest('[data-open-case]');if(button){lastCaseTrigger=button;openCase(button.dataset.openCase);}});
byId('closeItem').addEventListener('click',()=>byId('itemDialog').close());
byId('itemDialog').addEventListener('close',()=>{
 const caseId=selectedCase;detail=null;selectedCase=null;comparisonContext=null;inlineError('triageError');syncControls();
 const fallback=[...document.querySelectorAll('[data-open-case]')].find(button=>button.dataset.openCase===caseId);
 const target=lastCaseTrigger?.isConnected?lastCaseTrigger:fallback;target?.focus({preventScroll:true});lastCaseTrigger=null;
});
byId('triageForm').addEventListener('submit',event=>{event.preventDefault();if(byId('triageForm').reportValidity())saveTriage();});
for(const id of ['triageState','triageOwner','triageNote'])byId(id).addEventListener(id==='triageState'?'change':'input',()=>{rememberDraft();text('triageStatus',draftChanged()?'Unsaved changes.':detail?.review?.changedAt?`Saved ${utc(detail.review.changedAt)}`:'No local decision saved yet.');});
byId('reopenTriage').addEventListener('click',()=>{if(busy||!sameDetail())return;byId('triageState').value='open';rememberDraft();saveTriage();});
byId('caseExport').addEventListener('click',()=>{if(sameDetail())perform('Exporting case review…',()=>download(`/api/cases/${encodeURIComponent(detail.item.caseId)}.json?${activeQuery()}`,`disburselens-case-${filename(detail.item.itemId)}-v${detail.version}.json`),{reload:false,success:'Case JSON download started with the captured item, owner, note and retained review history.'});});
byId('modelSignals').addEventListener('click',event=>{
 const button=event.target.closest('[data-note-term]');if(!button)return;
 const target=[...byId('detailNote').querySelectorAll('mark')].find(mark=>mark.dataset.token===button.dataset.noteTerm.toLowerCase());
 byId('detailNote').focus({preventScroll:true});(target||byId('detailNote')).scrollIntoView({block:'nearest',inline:'nearest'});
});
byId('comparisonForm').addEventListener('submit',runComparison);
for(const id of ['baseline','followup','staleHours'])byId(id).addEventListener('change',()=>clearComparison('Comparison inputs changed. Select Compare to use this pair and threshold.'));
byId('comparisonRows').addEventListener('click',event=>{const button=event.target.closest('[data-compare-source]');if(button){lastCaseTrigger=button;openComparisonSource(button);}});
byId('comparisonJSON').addEventListener('click',()=>exportComparison('json'));
byId('comparisonCSV').addEventListener('click',()=>exportComparison('csv'));
byId('comparisonHTML').addEventListener('click',()=>exportComparison('html'));
byId('casebookExport').addEventListener('click',()=>{
 if(!report)return;perform('Exporting review-state casebook…',async()=>{
  const saved=await api(`/api/casebook.json?${activeQuery()}`);saveJSON(saved,`disburselens-casebook-${saved.evidenceHash.slice(0,12)}-v${saved.exportVersion}.json`);
 },{reload:false,success:'Review-state casebook download started. Owner notes remain in the workspace and the payout/case exports.'});
});
byId('casebookImport').addEventListener('change',importCasebook);
byId('casebookRestore').addEventListener('click',restoreCasebook);
byId('casebookCancel').addEventListener('click',()=>{if(!busy){clearPreview('Restore preview cancelled.');inlineError('casebookError');}});
async function initialize(){
 setBusy(true,'Loading retained payout workspace…');
 try{await loadContext();notice('');}
 catch(error){notice(`Could not load the workspace: ${error.message} Use Refresh workspace to try again.`,'error');text('source','Connection unavailable');text('observationStatus','Workspace data could not be loaded.');byId('rows').innerHTML=`<tr><td colspan='6' class='empty'>Workspace unavailable. Use Refresh workspace to load the current observation.</td></tr>`;}
 finally{setBusy(false);}
}
initialize();
