import {
 MAX_ARCHIVE_BYTES, readLibrary, exportProjects, openArchive, reviewReceiving,
 commitReceiving, readReceipt, exportReceipt, reviewUndo, commitUndo,
 saveWorking, loadWorking, recoverWorking, downloadProject
} from './saved-project-library.mjs';

const $=selector=>document.querySelector(selector);
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const pretty=value=>JSON.stringify(value,null,2)+'\n';
const clone=value=>JSON.parse(JSON.stringify(value));
const date=value=>{if(!value)return 'Not recorded';const d=new Date(value);return Number.isFinite(d.getTime())?new Intl.DateTimeFormat(undefined,{dateStyle:'medium',timeStyle:'short'}).format(d):String(value)};
const size=bytes=>Number.isFinite(bytes)?(bytes<1024?bytes+' bytes':new Intl.NumberFormat(undefined,{maximumFractionDigits:1}).format(bytes/1024)+' KB'):'Size unavailable';
const array=value=>Array.isArray(value)?value:[];
let library={records:[],receipts:[],working:[]},section='saved',busy=false;
let selected=new Set(),archive=null,rawText='',filename='',label='',review=null,choices={},pending=null,completedReceipt=null;
let working={id:null,revision:0},workingMode='receive',workingMessage='',needsComparison=false;
let receiptData=null,undoReview=null,undoIds=new Set(),recordDownload=null,workingReceiptId=null,pendingSaved=false,importedWorkingOriginal=null;

function status(message){$('#projects-status').textContent=message}
function error(problem){const message=problem?.message||String(problem);$('#projects-error').textContent=message;$('#projects-error').hidden=false}
function clearError(){$('#projects-error').hidden=true;$('#projects-error').textContent=''}
function downloadText(text,filename,type='application/json'){
 const blob=new Blob([text],{type}),url=URL.createObjectURL(blob),a=document.createElement('a');
 a.href=url;a.download=filename;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
function downloadResult(result){if(typeof result?.text!=='string'||typeof result.filename!=='string')throw Error('The complete download was not returned.');downloadText(result.text,result.filename)}
function safeLink(value){try{const u=new URL(value,location.href);return u.origin===location.origin&&['http:','https:'].includes(u.protocol)?u.href:null}catch{return null}}
async function run(action){
 if(busy)return;busy=true;clearError();$('#projects-main').inert=true;$('#projects-main').setAttribute('aria-busy','true');
 try{await action()}catch(problem){error(problem)}finally{busy=false;$('#projects-main').inert=false;$('#projects-main').removeAttribute('aria-busy');render()}
}
function showSection(value){section=value;render();$('#section-'+value).querySelector('h2')?.scrollIntoView({block:'nearest'})}
function workingValue(){
 return {label,filename,rawText,choices:clone(choices),requestId:pending?.requestId||null,review:review?clone(review):null,mode:workingMode,
  pending:pending?clone(pending):null,completedReceipt,needsComparison,receiptId:workingReceiptId,importedWorkingOriginal,
  undoReview:undoReview?clone(undoReview):null,undoIds:[...undoIds]};
}
async function persistWorking(fork=false){
 const value=workingValue();
 const saved=await saveWorking({id:fork?null:working.id,revision:fork?0:working.revision,value});
 working={id:saved.id,revision:saved.revision};pendingSaved=!!pending;workingMessage='Working copy saved '+date(saved.updatedAt)+'.';
 const url=new URL(location.href);url.searchParams.set('working',saved.id);window.history.replaceState(null,'',url);
 return saved;
}
async function reloadLibrary(){
 library=await readLibrary();
 if(!Array.isArray(library.records)||!Array.isArray(library.receipts)||!Array.isArray(library.working))throw Error('The saved-project list is incomplete. Refresh before changing work.');
 const present=new Set(library.records.map(r=>r.id));selected=new Set([...selected].filter(id=>present.has(id)));
}
function clearWorking(){
 archive=null;rawText='';filename='';label='';review=null;choices={};pending=null;completedReceipt=null;
 working={id:null,revision:0};workingMode='receive';workingMessage='';needsComparison=false;
 undoReview=null;undoIds=new Set();receiptData=null;workingReceiptId=null;pendingSaved=false;importedWorkingOriginal=null;
 const url=new URL(location.href);url.searchParams.delete('working');window.history.replaceState(null,'',url);
}
function filteredRecords(){
 const query=$('#project-search').value.trim().toLocaleLowerCase(),kind=$('#project-type').value,sort=$('#project-sort').value;
 const rows=library.records.filter(r=>(!kind||r.kind===kind)&&(!query||[r.name,r.kindLabel,r.id].some(v=>String(v??'').toLocaleLowerCase().includes(query))));
 rows.sort((a,b)=>sort==='name'?String(a.name).localeCompare(String(b.name)):sort==='type'?String(a.kindLabel).localeCompare(String(b.kindLabel))||String(a.name).localeCompare(String(b.name)):String(b.updatedAt||'').localeCompare(String(a.updatedAt||''))||String(a.name).localeCompare(String(b.name)));
 return rows;
}
function renderSaved(){
 const type=$('#project-type').value,types=new Map(library.records.map(r=>[r.kind,r.kindLabel]));
 $('#project-type').innerHTML='<option value="">All types</option>'+[...types].sort((a,b)=>String(a[1]).localeCompare(String(b[1]))).map(([k,v])=>'<option value="'+esc(k)+'">'+esc(v)+'</option>').join('');
 if(types.has(type))$('#project-type').value=type;
 const rows=filteredRecords();
 $('#saved-count').textContent=library.records.length;
 $('#saved-summary').textContent=rows.length+' of '+library.records.length+' saved projects shown.';
 $('#selection-summary').textContent=selected.size+' project'+(selected.size===1?'':'s')+' selected across all filters.';
 $('#saved-empty').hidden=rows.length>0;
 $('#saved-empty').textContent=library.records.length?'No saved work matches these filters.':'No saved projects yet. Save work in an original editor, then refresh this desk.';
 $('#export-selected').disabled=!selected.size;const history=$('#include-history').checked,workingCopies=$('#include-working').checked;
 $('#export-all').disabled=!(library.records.length||(history&&library.receipts.length)||(workingCopies&&library.working.length));
 $('#export-all').textContent=history&&workingCopies?'Download complete backup':'Download all saved projects';
 $('#select-visible').disabled=!rows.length;$('#clear-selected').disabled=!selected.size;
 $('#project-rows').innerHTML=rows.map(r=>{
  const href=r.workflow?safeLink(r.workflow.href):null;
  return '<tr><td><input type="checkbox" data-select-record="'+esc(r.id)+'" aria-label="Select '+esc(r.name)+'"'+(selected.has(r.id)?' checked':'')+'></td><td class="record-title"><strong>'+esc(r.name)+'</strong><small>'+esc(size(r.bytes))+' · Saved version '+esc(r.revision)+'</small></td><td>'+esc(r.kindLabel)+'</td><td>'+esc(date(r.updatedAt))+'</td><td><div class="actions">'+(href?'<a href="'+esc(href)+'">'+esc(r.workflow.label||'Open project')+'</a>':'<span class="muted">Complete record available</span>')+'<button type="button" data-inspect-project="'+esc(r.id)+'">Inspect</button><button type="button" data-download-project="'+esc(r.id)+'">Download</button></div></td></tr>';
 }).join('');
}
function renderWorking(){
 $('#working-rows').innerHTML=library.working.map(w=>'<tr><td><strong>'+esc(w.name)+'</strong><small>Saved version '+esc(w.revision)+(w.id===working.id?' · Current working copy':'')+'</small></td><td>'+esc(date(w.updatedAt))+'</td><td><button type="button" data-open-working="'+esc(w.id)+'">Open working copy</button></td></tr>').join('');
 $('#working-empty').hidden=library.working.length>0;
 const active=!!(rawText||pending||undoReview||working.id);
 $('#save-working').disabled=!active;$('#fork-working').disabled=!active;$('#download-working').disabled=!active;
}
function decisionLabel(choice){return {restore:'Restore incoming project',replace:'Replace local; retain its previous version',keep:'Keep local position'}[choice]||choice}
function renderReceiving(){
 $('#receive-pending').hidden=!pending;
 $('#pending-summary').textContent=pending?(pending.kind==='undo'?'Undo':'Receiving')+' request '+pending.requestId+' is retained with its original choices.':'';
 $('#archive-review').hidden=!archive;$('#receive-empty').hidden=!!archive||!!pending||!!rawText;
 $('#receive-save-state').textContent=workingMessage||(working.id?'Working copy '+working.id:'');
 if(!archive)return;
 if(document.activeElement!==$('#receive-label'))$('#receive-label').value=label;
 $('#archive-summary').innerHTML='<dt>Archive</dt><dd>'+esc(archive.label||filename||'Saved projects')+'</dd><dt>Created</dt><dd>'+esc(date(archive.createdAt))+'</dd><dt>Complete projects</dt><dd>'+array(archive.records).length+'</dd><dt>Retained earlier history</dt><dd>'+array(archive.history).length+' record(s)</dd><dt>Unfinished working copies</dt><dd>'+array(archive.working).length+'</dd><dt>File</dt><dd>'+esc(filename||'Retained complete archive')+' · '+esc(size(archive.bytes))+'</dd>';
 $('#receive-summary').textContent=review?review.rows.length+' complete projects compared with this browser.':'Compare this archive with current saved work.';
 $('#receive-rows').innerHTML=(review?.rows||[]).map(row=>{
  const value=choices[row.id]||row.defaultChoice;
  return '<tr><td class="record-title"><strong>'+esc(row.incoming.name)+'</strong><small>'+esc(row.incoming.kindLabel)+' · '+esc(size(row.incoming.bytes))+'</small></td><td>'+(row.current?'<strong>'+esc(row.current.name)+'</strong><small>'+esc(date(row.current.updatedAt))+' · '+esc(row.status==='IDENTICAL'?'Identical complete record':'Different saved record')+'</small>':'No local record')+'</td><td><label class="sr-only" for="choice-'+esc(row.id)+'">Receiving decision for '+esc(row.incoming.name)+'</label><select id="choice-'+esc(row.id)+'" data-receive-choice="'+esc(row.id)+'"'+(pending||completedReceipt?' disabled':'')+'>'+row.allowed.map(choice=>'<option value="'+choice+'"'+(value===choice?' selected':'')+'>'+esc(decisionLabel(choice))+'</option>').join('')+'</select></td><td><button type="button" data-inspect-receiving="'+esc(row.id)+'">Compare details</button></td></tr>';
 }).join('');
 const all=review?.rows||[],restore=all.filter(r=>choices[r.id]==='restore').length,replace=all.filter(r=>choices[r.id]==='replace').length,keep=all.filter(r=>choices[r.id]==='keep').length;
 $('#apply-summary').textContent=completedReceipt?'This review has a completed result. Compare with current saved work to prepare another receiving decision.':needsComparison?'Compare with current saved work before applying this recovered review.':restore+' new projects will be restored; '+replace+' local records will be replaced with their previous versions retained; '+keep+' local positions will be kept.';
 $('#apply-import').disabled=!review||!!pending||!!completedReceipt||needsComparison;
 for(const id of ['refresh-preview','receive-separate','receive-keep','discard-review'])$('#'+id).disabled=!!pending;
}
function resultCount(receipt){return typeof receipt.records==='number'?receipt.records:['restored','replaced','kept','undone'].reduce((sum,k)=>sum+array(receipt[k]).length,0)}
function renderHistory(){
 $('#history-empty').hidden=library.receipts.length>0;
 $('#history-rows').innerHTML=library.receipts.map(r=>'<tr><td><strong>'+esc(r.label||'Received projects')+'</strong><small>'+esc(r.kind==='undo'?'Undo':'Receive')+'</small></td><td>'+esc(date(r.at))+'</td><td>'+esc(r.records)+' record(s)</td><td><div class="actions"><button type="button" data-open-receipt="'+esc(r.id)+'">Open result</button><button type="button" data-download-receipt="'+esc(r.id)+'">Download</button></div></td></tr>').join('');
 $('#receipt-panel').hidden=!receiptData;
 if(!receiptData)return;
 const r=receiptData.receipt;
 $('#receipt-summary').textContent=(r.label||'Receiving operation')+' · '+date(r.at)+' · '+resultCount(r)+' recorded decisions.';
 const passive=receiptData.passive||{};
 $('#receipt-details').innerHTML='<details><summary>Complete original result and current records</summary><pre>'+esc(pretty({receipt:r,current:receiptData.current,passiveHistory:passive.history||[]}))+'</pre></details>'+
 (array(passive.working).length?'<h3>Retained unfinished work from this archive</h3><p class="muted">Open a new local working copy. Its choices are retained for a fresh comparison with this browser.</p><div class="actions">'+passive.working.map(w=>'<button type="button" data-recover-passive="'+esc(w.id)+'">'+esc(w.name||'Recover working review')+'</button>').join('')+'</div>':'');
 $('#undo-panel').hidden=r.kind!=='receive';
 if(r.kind!=='receive')return;
 $('#undo-rows').innerHTML=(undoReview?.rows||[]).map(row=>'<tr><td><input type="checkbox" data-undo-record="'+esc(row.id)+'" aria-label="Undo receiving for '+esc(row.current?.name||row.after?.name||row.before?.name||row.id)+'"'+(undoIds.has(row.id)?' checked':'')+(!row.canRestore||pending?' disabled':'')+'></td><td><strong>'+esc(row.current?.name||row.after?.name||row.before?.name||row.id)+'</strong><small>'+(row.before?'Restore original local version':'Remove unchanged record created by this receiving')+'</small></td><td>'+esc(row.canRestore?'Unchanged since receiving':row.status==='STAFF_CHANGED'?'Later edits retained; unavailable for undo':row.status==='ABSENT'?'Record absent; no unchanged record to restore':row.status)+'</td></tr>').join('');
 $('#apply-undo').disabled=!undoReview||!undoIds.size||!!pending||(workingMode==='undo'&&workingReceiptId===r.id&&needsComparison);
 $('#refresh-undo').disabled=!!pending;
 $('#undo-status').textContent=undoReview?undoIds.size+' unchanged record(s) selected.':'Open the current position to review undo choices.';
}
function render(){
 document.querySelectorAll('[data-section]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.section===section)));
 for(const name of ['saved','receive','history'])$('#section-'+name).hidden=name!==section;
 renderSaved();renderWorking();renderReceiving();renderHistory();
}
async function compareArchive(){
 if(pending)throw Error('Recover the retained original request before changing its comparison.');
 if(!archive)throw Error('Open a complete archive first.');
 const next=await reviewReceiving(archive),nextChoices={};
 for(const row of next.rows)nextChoices[row.id]=row.allowed.includes(choices[row.id])?choices[row.id]:row.defaultChoice;
 review=next;choices=nextChoices;completedReceipt=null;needsComparison=false;workingMode='receive';
 await persistWorking();await reloadLibrary();status('The complete archive is compared with current saved work. Review each receiving decision.');
}
async function openWorkingValue(saved){
 const value=saved.value;
 if(!value||typeof value!=='object')throw Error('The saved working copy is incomplete.');
 clearWorking();working={id:saved.id,revision:saved.revision};
 rawText=typeof value.rawText==='string'?value.rawText:'';filename=typeof value.filename==='string'?value.filename:'';
 label=typeof value.label==='string'?value.label:'';choices=value.choices||{};review=value.review||null;
 pending=value.pending||null;pendingSaved=!!pending;workingMode=value.mode||'receive';completedReceipt=value.completedReceipt||null;workingReceiptId=value.receiptId||null;importedWorkingOriginal=value.importedWorkingOriginal||null;
 const url=new URL(location.href);url.searchParams.set('working',saved.id);window.history.replaceState(null,'',url);
 needsComparison=value.needsComparison===true||(!pending&&!review);
 undoReview=value.undoReview||null;undoIds=new Set(value.undoIds||[]);
 workingMessage='Opened complete saved working copy. Existing receiving choices are preserved.';
 section='receive';receiptData=null;
 if(rawText){try{archive=await openArchive(rawText)}catch(problem){error(problem);status('The original unfinished file text is retained. Download it or select a complete corrected archive.');return;}}
 if(value.receiptId){receiptData=await readReceipt(value.receiptId);if(workingMode==='undo')section='history';}
 status(pending?'Recovered the exact retained request. Recover its original result before changing choices.':'Working copy reopened. Compare with current saved work before applying a new review.');
 if(!pending&&!completedReceipt)needsComparison=true;
}
async function openWorkingCopy(id){
 if(pending)throw Error('Recover the retained original request before opening another working copy.');
 if(rawText||undoReview)await persistWorking();
 await openWorkingValue(await loadWorking(id));
}
async function openReceiptView(id){
 receiptData=await readReceipt(id);undoReview=null;undoIds=new Set();section='history';
 if(receiptData.receipt.kind==='receive'){
  undoReview=await reviewUndo(id);undoIds=new Set(undoReview.rows.filter(row=>row.canRestore).map(row=>row.id));
 }
}
async function finishResult(result){
 const old=pending;
 if(!result?.receipt||result.receipt.requestId!==old?.requestId)throw Error('The returned result does not match the original receiving request. Keep that request for recovery.');
 completedReceipt=result.receipt.id;workingReceiptId=result.receipt.id;pending=null;pendingSaved=false;workingMessage='Original receiving result recovered.';
 try{await persistWorking()}catch(problem){
  // The database receipt remains authoritative even if this working-copy save fails.
  pending=old;pendingSaved=true;workingMessage='The result is saved; working-copy update failed. Recover this same original request.';
  throw problem;
 }
 await reloadLibrary();await openReceiptView(result.receipt.id);
 status(result.replayed?'Recovered the original saved result. Later project edits are retained.':'Receiving completed. Every selected decision and its original result are saved.');
}
async function sendPending(){
 if(!pending)throw Error('No original receiving request is retained.');
 if(!pendingSaved)await persistWorking();
 const p=pending;let result;
 if(p.kind==='receive'){
  if(!archive)archive=await openArchive(rawText);
  result=await commitReceiving({archive,review:p.review,choices:p.choices,requestId:p.requestId,label:p.label});
 }else if(p.kind==='undo')result=await commitUndo({review:p.review,ids:p.ids,requestId:p.requestId,label:p.label});
 else throw Error('This retained request has an unknown operation. Download it before continuing.');
 await finishResult(result);
}
async function beginImport(){
 if(!archive||!review||pending||completedReceipt||needsComparison)throw Error('Compare the complete archive and review its decisions before receiving.');
 for(const row of review.rows)if(!row.allowed.includes(choices[row.id]))throw Error('Choose an allowed receiving decision for every project.');
 pending={kind:'receive',requestId:crypto.randomUUID(),review:clone(review),choices:clone(choices),label:label||archive.label||'Received saved projects'};
 workingMode='receive';pendingSaved=false;await persistWorking();await sendPending();
}
async function prepareUndoWorking(){
 if(!receiptData||!undoReview)throw Error('Open a complete receiving result first.');
 const target=receiptData,comparison=undoReview,ids=new Set(undoIds);
 if(workingMode!=='undo'||workingReceiptId!==target.receipt.id||completedReceipt){
  if(rawText||working.id)await persistWorking();
  clearWorking();receiptData=target;undoReview=comparison;undoIds=ids;workingMode='undo';
  workingReceiptId=target.receipt.id;label='Undo '+(target.receipt.label||'received projects');
 }
}
async function beginUndo(){
 if(pending||!receiptData||!undoReview||!undoIds.size||(workingMode==='undo'&&workingReceiptId===receiptData.receipt.id&&needsComparison))throw Error('Review the current unchanged received records before undoing.');
 const allowed=new Set(undoReview.rows.filter(row=>row.canRestore).map(row=>row.id));
 if([...undoIds].some(id=>!allowed.has(id)))throw Error('Refresh the receiving result; a selected record cannot be restored.');
 await prepareUndoWorking();
 pending={kind:'undo',requestId:crypto.randomUUID(),review:clone(undoReview),ids:[...undoIds].sort(),label};
 pendingSaved=false;await persistWorking();await sendPending();
}
async function inspectProject(id){
 const r=library.records.find(x=>x.id===id),result=await downloadProject(id);
 showRecord(r?.name||'Saved project','Complete original saved record',result.text,result.filename);
}
function showRecord(title,context,text,filename){
 recordDownload={text,filename};$('#record-heading').textContent=title;$('#record-context').textContent=context;
 const max=250000;$('#record-content').textContent=text.length>max?text.slice(0,max)+'\n\nPreview ends here. Download the complete record for every original field.':text;
 $('#record-dialog').showModal();
}
async function exportSelection(ids){
 const includeHistory=$('#include-history').checked,includeWorking=$('#include-working').checked;
 if(!ids.length&&!(includeHistory&&library.receipts.length)&&!(includeWorking&&library.working.length))throw Error('Select saved projects or retained history and working copies first.');
 const result=await exportProjects({ids,label:'Saved projects — '+new Date().toISOString().slice(0,10),includeHistory,includeWorking});
 downloadResult(result);status('Downloaded '+result.summary.records+' complete project record(s), '+result.summary.receipts+' receiving history record(s) and '+result.summary.working+' unfinished working copy/copies.');
}
$('#refresh-projects').onclick=()=>run(async()=>{await reloadLibrary();if((review||undoReview)&&!pending&&!completedReceipt)needsComparison=true;status('Saved projects refreshed. Existing receiving choices remain available for an explicit current comparison.');});
for(const id of ['project-search','project-type','project-sort'])$('#'+id).addEventListener(id==='project-search'?'input':'change',renderSaved);
$('#select-visible').onclick=()=>{filteredRecords().forEach(r=>selected.add(r.id));renderSaved()};
$('#clear-selected').onclick=()=>{selected.clear();renderSaved()};
$('#export-selected').onclick=()=>run(()=>exportSelection([...selected]));
$('#export-all').onclick=()=>run(()=>exportSelection(library.records.map(r=>r.id)));
for(const id of ['include-history','include-working'])$('#'+id).onchange=renderSaved;
$('#archive-form').onsubmit=event=>{event.preventDefault();run(async()=>{
 if(pending)throw Error('Recover the original retained receiving request before opening another archive.');
 const file=$('#archive-file').files[0];if(!file)throw Error('Choose a complete saved-project archive.');
 if(file.size>MAX_ARCHIVE_BYTES)throw Error('The selected archive exceeds the supported '+Math.floor(MAX_ARCHIVE_BYTES/1024/1024)+' MB limit.');
 if(rawText||undoReview)await persistWorking();
 clearWorking();filename=file.name;rawText=await file.text();label=file.name.replace(/\.json$/i,'');section='receive';
 let wrapper;try{wrapper=JSON.parse(rawText)}catch{}
 if(wrapper&&['stellar-forge.saved-project-working-review/v1','stellar-forge.saved-project-working-request/v1'].includes(wrapper.schema)){
  if(!wrapper.working||typeof wrapper.working!=='object'||typeof wrapper.working.rawText!=='string')throw Error('The downloaded working review is incomplete.');
  const original=clone(wrapper.working);
  importedWorkingOriginal=original;rawText=original.rawText;filename=original.filename||file.name;label=original.label||label;choices=original.choices||{};
  review=null;pending=null;pendingSaved=false;completedReceipt=null;needsComparison=true;workingMode='receive';
  await persistWorking();
  if(rawText)archive=await openArchive(rawText);
  status('The complete downloaded working review is retained as a new copy. Its earlier request and choices are preserved as source; compare with this browser before applying.');
 }else{
  await persistWorking(); // Keep even malformed unfinished input for recovery and download.
  archive=await openArchive(rawText);await compareArchive();
 }
})};
$('#receive-label').onchange=()=>run(async()=>{label=$('#receive-label').value;await persistWorking();await reloadLibrary()});
$('#refresh-preview').onclick=()=>run(compareArchive);
$('#download-incoming').onclick=()=>downloadText(rawText,filename||'saved-projects-original.json');
$('#discard-review').onclick=()=>run(async()=>{if(pending)throw Error('Recover the retained request first.');if(rawText||undoReview)await persistWorking();clearWorking();await reloadLibrary();status('Review closed. Its complete saved working copy remains available.');});
$('#receive-separate').onclick=()=>run(async()=>{if(pending||completedReceipt)throw Error('Compare the current saved work before changing a completed request.');for(const row of review?.rows||[])choices[row.id]=row.allowed.includes('restore')?'restore':'keep';await persistWorking();await reloadLibrary()});
$('#receive-keep').onclick=()=>run(async()=>{if(pending||completedReceipt)throw Error('Compare the current saved work before changing a completed request.');for(const row of review?.rows||[])choices[row.id]='keep';await persistWorking();await reloadLibrary()});
$('#apply-import').onclick=()=>run(beginImport);
$('#retry-import').onclick=()=>run(sendPending);
$('#download-request').onclick=()=>downloadText(pretty({schema:'stellar-forge.saved-project-working-request/v1',working:workingValue()}),'saved-projects-original-request.json');
$('#save-working').onclick=()=>run(async()=>{await persistWorking();await reloadLibrary();status('Complete receiving work saved.');});
$('#fork-working').onclick=()=>run(async()=>{await persistWorking(true);await reloadLibrary();status(pending?'Saved a separate working copy with the same exact original request. Recover its original result.':'Saved a separate complete working copy. The earlier copy is retained.');});
$('#download-working').onclick=()=>downloadText(pretty({schema:'stellar-forge.saved-project-working-review/v1',working:workingValue()}),'saved-projects-working-review.json');
$('#download-receipt').onclick=()=>run(async()=>downloadResult(await exportReceipt(receiptData.receipt.id)));
$('#close-receipt').onclick=()=>{receiptData=null;undoReview=null;undoIds=new Set();renderHistory()};
$('#refresh-undo').onclick=()=>run(async()=>{undoReview=await reviewUndo(receiptData.receipt.id);needsComparison=false;const allowed=new Set(undoReview.rows.filter(row=>row.canRestore).map(row=>row.id));undoIds=new Set([...undoIds].filter(id=>allowed.has(id)));if(workingMode==='undo'&&workingReceiptId===receiptData.receipt.id){await persistWorking();await reloadLibrary();}status('Current received records compared. Later edits remain excluded from undo.');});
$('#apply-undo').onclick=()=>run(beginUndo);
$('#close-record').onclick=()=>$('#record-dialog').close();
$('#download-record').onclick=()=>{if(recordDownload)downloadText(recordDownload.text,recordDownload.filename)};
document.addEventListener('change',event=>{
 const el=event.target;
 if(el.matches('[data-select-record]')){el.checked?selected.add(el.dataset.selectRecord):selected.delete(el.dataset.selectRecord);renderSaved();}
 else if(el.matches('[data-receive-choice]')){const id=el.dataset.receiveChoice,value=el.value;run(async()=>{if(pending||completedReceipt)throw Error('The original receiving decision is frozen.');choices[id]=value;await persistWorking();await reloadLibrary()});}
 else if(el.matches('[data-undo-record]')){const id=el.dataset.undoRecord,checked=el.checked;run(async()=>{checked?undoIds.add(id):undoIds.delete(id);await prepareUndoWorking();await persistWorking();await reloadLibrary()});}
});
document.addEventListener('click',event=>{
 const b=event.target.closest('button');if(!b)return;
 if(b.dataset.section){showSection(b.dataset.section);return;}
 if(b.dataset.inspectProject)run(()=>inspectProject(b.dataset.inspectProject));
 else if(b.dataset.downloadProject)run(async()=>downloadResult(await downloadProject(b.dataset.downloadProject)));
 else if(b.dataset.openWorking)run(()=>openWorkingCopy(b.dataset.openWorking));
 else if(b.dataset.openReceipt)run(()=>openReceiptView(b.dataset.openReceipt));
 else if(b.dataset.downloadReceipt)run(async()=>downloadResult(await exportReceipt(b.dataset.downloadReceipt)));
 else if(b.dataset.inspectReceiving){const row=review.rows.find(r=>r.id===b.dataset.inspectReceiving);showRecord(row.incoming.name,'Original complete incoming and local identities',pretty(row),'saved-project-comparison.json');}
 else if(b.dataset.recoverPassive)run(async()=>{if(pending)throw Error('Recover the original retained request first.');if(rawText||working.id)await persistWorking();await openWorkingValue(await recoverWorking(receiptData.receipt.id,b.dataset.recoverPassive));await reloadLibrary();status('Recovered a new local working copy. Compare explicitly with this browser before applying.');});
});
window.addEventListener('storage',()=>{if(!busy)status('Browser storage changed in another window. Refresh saved work before a new receiving review.');});
await run(async()=>{const resume=new URL(location.href).searchParams.get('working');await reloadLibrary();if(resume)await openWorkingValue(await loadWorking(resume));else status(library.records.length+' complete saved project(s) available.');});
