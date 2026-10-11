let report=null;let filter='all';
let busy=false,casebook=null,casebookPreview=null;
const CASEBOOK_LIMIT=262144;
const byId=id=>document.getElementById(id);
const safe=value=>String(value??'').replace(/[&<>"']/g, x=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[x]));
function alert(message){const element=byId('alert');element.hidden=!message;element.textContent=message;}
const statusTag=status=>{let cls=status==='SUCCESS'?'ok':['FAILED','DENIED','RETURNED','BLOCKED'].includes(status)?'bad':'warn';return `<span class="pill ${cls}">${safe(status)}</span>`;};
async function api(path,method='GET',body){
  const res=await fetch(path,{method,headers:body?{'Content-Type':'application/json'}:{},body:body?JSON.stringify(body):undefined});
  const obj=await res.json().catch(()=>({error:`HTTP ${res.status}`}));
  if(!res.ok){const error=new Error(obj.error||`HTTP ${res.status}`);error.status=res.status;throw error;}return obj;
}
function render(){
 if(!report)return;
 byId('source').textContent=report.source;
 byId('items').textContent=report.totals.count;
 byId('batch').textContent=report.id;
 byId('amount').textContent=`${report.totals.currency} ${report.totals.itemSum}`;
 byId('balanced').textContent=report.totals.match===null?'No aggregate amount reported':report.totals.match?'Batch amount agrees':'Aggregate mismatch — review';
 byId('flags').textContent=report.items.filter(x=>x.flags.length).length;
 byId('pending').textContent=report.totals.unresolved;
 byId('digest').textContent=`Evidence SHA256: ${report.evidenceHash}`;
 byId('limitations').textContent=report.limitations.join(' ');
 const visible=report.items.filter(item=>filter==='all'||(filter==='review'?item.flags.length:!item.flags.length));
 byId('counter').textContent=`(${visible.length})`;
 byId('rows').innerHTML=visible.map(item=>{
   const state=report.cases[item.caseId]?.state||'open';
   const signals=item.signals.topSignals.filter(x=>x.reviewLift>0).map(x=>x.token).slice(0,3).join(', ');
   const risk=item.flags.length?item.flags.join(' · '):'No rule or model flags';
   const explanation=item.signals.knownTokens?`Trained review propensity ${(item.signals.reviewProbability*100).toFixed(0)}%; terms: ${signals||'no positive signals'}`:'No known training words';
   return `<tr>
     <td><strong>${safe(item.receiver)}</strong><small>${safe(item.itemId)}</small><div class="signal">${safe(item.note.slice(0,75))}</div></td>
     <td><strong>${safe(item.currency)} ${safe(item.amount)}</strong><small>${safe(item.senderItemId)}</small></td>
     <td>${statusTag(item.status)}</td>
     <td><div class="signal" title="${safe(explanation)}">${item.signals.reviewProbability>=.67?'<span class="pill warn">Review suggested</span>':'<span class="pill">Low text signal</span>'}<small>${safe(explanation)}</small></div></td>
     <td><div class="signal">${safe(risk)}</div><span class="pill ${state==='escalated'?'bad':state==='acknowledged'?'ok':''}">${safe(state)}</span></td>
     <td><button class="reviewbtn action" data-case="${safe(item.caseId)}" data-state="escalated">Escalate</button><button class="reviewbtn" data-case="${safe(item.caseId)}" data-state="acknowledged">Acknowledge</button></td>
   </tr>`;
 }).join('');
 syncControls();
}
function node(tag,text,className){
 const element=document.createElement(tag);
 if(text!==undefined)element.textContent=String(text);
 if(className)element.className=className;
 return element;
}
function casebookError(message=''){
 byId('casebookError').textContent=message;byId('casebookError').hidden=!message;
}
function clearPreview(message){
 casebook=null;casebookPreview=null;
 byId('casebookPreview').hidden=true;
 byId('casebookChanges').replaceChildren();
 if(message)byId('casebookStatus').textContent=message;
 syncControls();
}
function syncControls(){
 for(const id of ['sync','demo','export','batchId','casebookExport','casebookImport','refreshReport'])
  byId(id).disabled=busy||(id!=='demo'&&!report);
 for(const button of document.querySelectorAll('[data-case],[data-filter]'))button.disabled=busy||!report;
 byId('casebookRestore').disabled=busy||!casebookPreview||!casebookPreview.changes.length;
 byId('casebookCancel').disabled=busy;
}
async function load(){
 const next=await api('/api/report');
 if(casebookPreview&&(next.version!==casebookPreview.currentVersion||next.evidenceHash!==casebookPreview.evidenceHash||next.source!==casebookPreview.source))
  clearPreview('The current review changed. Open the saved casebook again to prepare a fresh preview.');
 report=next;render();
}
async function act(fn){
 if(busy)return;
 busy=true;syncControls();
 try{alert('');await fn();await load();}
 catch(error){
  alert(error.message);
  try{await load();}catch{alert(`${error.message} Current review could not be refreshed; use Refresh current review before continuing.`);}
 }finally{busy=false;syncControls();}
}
function downloadJSON(value,filename){
 const href=URL.createObjectURL(new Blob([JSON.stringify(value,null,2)+'\n'],{type:'application/json'}));
 const link=node('a');link.href=href;link.download=filename;document.body.append(link);link.click();link.remove();
 setTimeout(()=>URL.revokeObjectURL(href),1000);
}
function showPreview(prepared){
 byId('casebookSummary').textContent=prepared.changes.length
  ?`${prepared.changes.length} review state${prepared.changes.length===1?'':'s'} will change. Saved totals: ${prepared.counts.open} open, ${prepared.counts.acknowledged} acknowledged, ${prepared.counts.escalated} escalated.`
  :'This casebook already matches every current review state. No restore is needed.';
 const fields=[['Evidence SHA-256',prepared.evidenceHash],['Source',prepared.source],
  ['Saved version / export time',`${prepared.exportVersion} / ${prepared.exportedAt}`],
  ['Current review version',prepared.currentVersion]];
 byId('casebookSource').replaceChildren(...fields.map(([label,value])=>{
  const wrap=node('div');wrap.append(node('dt',label),node('dd',value));return wrap;
 }));
 byId('casebookChanges').replaceChildren(...prepared.changes.map(change=>{
  const row=node('li');row.append(node('code',change.caseId),node('span',`${change.from} → ${change.to}`));return row;
 }));
 byId('casebookRestore').textContent=`Restore ${prepared.changes.length} review state${prepared.changes.length===1?'':'s'}`;
 byId('casebookPreview').hidden=false;
 byId('casebookPreviewHeading').focus();
}
byId('sync').addEventListener('click',()=>act(async()=>{
 const batchId=byId('batchId').value.trim();if(!batchId)throw new Error('Enter a sandbox batch ID');
 await api('/api/sync','POST',{batchId});
}));
byId('demo').addEventListener('click',()=>act(()=>api('/api/load-demo','POST',{})));
byId('export').addEventListener('click',()=>{
 if(busy||!report)return;
 const link=node('a');link.href='/api/export.csv';link.download='disburselens-redacted-evidence.csv';link.click();
});
document.querySelectorAll('[data-filter]').forEach(button=>button.addEventListener('click',()=>{
 if(busy)return;
 filter=button.dataset.filter;
 document.querySelectorAll('[data-filter]').forEach(x=>x.classList.toggle('active',x===button));render();
}));
byId('rows').addEventListener('click',event=>{
 const target=event.target.closest('button[data-case]');if(!target||!report||busy)return;
 const body={caseId:target.dataset.case,state:target.dataset.state,version:report.version};
 act(()=>api('/api/decision','POST',body));
});
byId('refreshReport').addEventListener('click',async()=>{
 if(busy)return;busy=true;syncControls();
 try{await load();alert('');casebookError('');byId('casebookStatus').textContent=casebookPreview
  ?'Current review refreshed; the preview still matches this version.'
  :'Current review refreshed. Open a saved casebook to preview its states.';}
 catch(error){casebookError(`Refresh failed: ${error.message}`);}
 finally{busy=false;syncControls();}
});
byId('casebookExport').addEventListener('click',async()=>{
 if(busy||!report)return;busy=true;syncControls();casebookError();
 let downloaded=false;
 try{
  const saved=await api('/api/casebook.json');
  downloadJSON(saved,`disburselens-casebook-${saved.evidenceHash.slice(0,12)}-v${saved.exportVersion}.json`);
  downloaded=true;
  byId('casebookStatus').textContent=`Downloaded ${saved.cases.length} review states from version ${saved.exportVersion}. This casebook contains no receivers, amounts or payout notes.`;
  // Show the current state even if another operator changed it before export.
  await load();
 }catch(error){casebookError(downloaded?`Casebook downloaded, but the current display could not be refreshed: ${error.message}`:`Casebook export failed: ${error.message}`);}
 finally{busy=false;syncControls();}
});
byId('casebookImport').addEventListener('change',async()=>{
 const file=byId('casebookImport').files[0];if(!file||busy||!report)return;
 busy=true;clearPreview();syncControls();casebookError();
 byId('casebookStatus').textContent='Reading the saved casebook and preparing a preview…';
 try{
  if(file.size>CASEBOOK_LIMIT)throw new Error('Casebook exceeds the 256 KiB limit');
  const text=await file.text();
  if(new TextEncoder().encode(text).byteLength>CASEBOOK_LIMIT)throw new Error('Casebook exceeds the 256 KiB limit');
  const selected=JSON.parse(text);
  const currentVersion=report.version;
  const body={version:currentVersion,casebook:selected};
  if(new TextEncoder().encode(JSON.stringify(body)).byteLength>CASEBOOK_LIMIT)throw new Error('Casebook request exceeds the 256 KiB limit');
  const prepared=await api('/api/casebook/preview','POST',body);
  if(prepared.currentVersion!==currentVersion)throw new Error('Review changed during preview; refresh and open the casebook again');
  casebook=selected;casebookPreview=prepared;showPreview(prepared);
  byId('casebookStatus').textContent='Preview ready. No review states have changed.';
 }catch(error){
  clearPreview('No casebook was applied. Correct the file or refresh and open it again.');
  casebookError(`Cannot preview this casebook: ${error.message}`);
  if(error.status===409){try{await load();}catch{casebookError(`${error.message} Current review could not be refreshed.`);}}
 }finally{byId('casebookImport').value='';busy=false;syncControls();}
});
byId('casebookCancel').addEventListener('click',()=>{
 if(busy)return;clearPreview('Preview cancelled. Current review states are unchanged.');casebookError();
});
byId('casebookRestore').addEventListener('click',async()=>{
 if(busy||!casebook||!casebookPreview||!casebookPreview.changes.length)return;
 const body={version:casebookPreview.currentVersion,casebook};
 busy=true;syncControls();casebookError();
 byId('casebookStatus').textContent='Restoring the previewed review states…';
 let applied=null;
 try{
  applied=await api('/api/casebook/restore','POST',body);
  clearPreview();
  await load();
  byId('casebookStatus').textContent=`Restored ${applied.changed} review state${applied.changed===1?'':'s'} at version ${applied.version}. Download a new casebook after further decisions.`;
 }catch(error){
  clearPreview();
  let refreshed=false;
  try{await load();refreshed=true;}catch{}
  const outcome=applied
   ?`Restore was accepted at version ${applied.version}, but refreshing the display failed.`
   :error.status?'The server rejected this restore; it was not applied.':'The restore response was not confirmed. No automatic retry was made.';
  byId('casebookStatus').textContent=refreshed
   ?`${outcome} The current review is now reloaded; compare its states before preparing another restore.`
   :`${outcome} Refresh current review before preparing another restore.`;
  casebookError(error.message);
 }finally{busy=false;syncControls();}
});
syncControls();
load().then(()=>{byId('casebookStatus').textContent='Download the current review states, or open a saved casebook for this exact evidence.';})
 .catch(error=>alert(error.message));
