"""Complete workspace backup and original export recovery in the Analysis UI."""

HTML = r'''
<section id="tab-archives" hidden>
<section class="panel"><div class="section-head"><div><h2>Workspace backup</h2><p>Save a consistent database together with its completed query exports, reports and workbook editions.</p></div><button id="archive-review">Refresh contents</button></div>
<label class="archive-check"><input id="archive-previous-backups" type="checkbox">Include earlier database backups</label>
<div id="archive-plan" class="facts" aria-live="polite"></div>
<div class="toolbar"><button id="archive-create" class="primary">Create complete backup</button><button id="archive-database-only">Create database backup only</button></div>
<p class="muted">The complete backup carries saved data and output files. The receiving application creates its own private launch link.</p>
<details><summary>Review saved output selection</summary><div class="form-row"><label for="archive-review-kind">Contents</label><select id="archive-review-kind"><option value="outputs">Included outputs</option><option value="exclusions">Separate or unselected outputs</option><option value="missing">Missing files</option></select></div>
<div class="table-scroll"><table><thead><tr><th>Type or reason</th><th>Saved output or file</th></tr></thead><tbody id="archive-review-rows"></tbody></table></div>
<div class="archive-page"><span id="archive-review-page" class="muted"></span><div class="toolbar"><button id="archive-review-prev">Previous</button><button id="archive-review-next">Next</button></div></div></details></section>

<section id="archive-selected" class="panel" hidden><div class="section-head"><div><h2>Selected backup</h2><p id="archive-job-status" role="status"></p></div><div class="toolbar"><button id="archive-resume">Resume this backup</button><button id="archive-cancel">Cancel export</button></div></div>
<div id="archive-job-facts" class="facts"></div><progress id="archive-progress" max="1" value="0" aria-label="Complete workspace export progress" hidden></progress><p id="archive-progress-text" class="muted" aria-live="polite"></p>
<div class="toolbar"><button id="archive-download" class="primary">Download workspace ZIP</button><button id="archive-manifest">Download manifest</button></div>
<p id="archive-download-state" class="muted" aria-live="polite"></p>
<details><summary>Open this backup on another computer</summary><p>Install the Stellar Forge buyer runtime on the receiving computer. Save the ZIP, then inspect and receive it into a new private folder. The same receive command continues an interrupted transfer.</p><pre id="archive-receive-command"></pre><p>After receiving, open the new workspace with the printed database path. Saved analyses, views and workbook editions are available offline.</p></details></section>

<section class="panel"><div class="section-head"><div><h2>Saved workspace backups</h2><p>Open an earlier export to download it or resume its retained snapshot.</p></div><div class="toolbar"><button id="archive-history-prev">Previous</button><button id="archive-history-next">Next</button></div></div>
<div class="table-scroll"><table><thead><tr><th>Created</th><th>Status</th><th>Files / bytes</th><th>Operation</th><th></th></tr></thead><tbody id="archive-history"></tbody></table></div><p id="archive-history-page" class="muted"></p></section>
</section>
'''

CSS = r'''
.archive-check input{accent-color:#333}#archive-download-state,#archive-progress-text{overflow-wrap:anywhere}#profiles-link{display:block;color:inherit;white-space:nowrap;padding:13px 18px;text-decoration:none;border-bottom:3px solid transparent}
.archive-check{display:flex;align-items:center;gap:9px;font-weight:400;margin:10px 0 14px}.archive-check input{width:auto;margin:0}.archive-page{display:flex;align-items:center;justify-content:space-between;gap:12px;margin-top:12px}#archive-progress{display:block;width:100%;height:14px;accent-color:#333}#archive-review-kind{max-width:380px}#archive-job-facts code{overflow-wrap:anywhere}#archive-history td:nth-child(4){overflow-wrap:anywhere;max-width:220px}@media(max-width:760px){.archive-page{align-items:flex-start;flex-direction:column}#archive-history td{min-width:100px}}
'''

JS = r'''
(()=>{
const a={plan:null,planKey:null,reviewKind:'outputs',reviewOffset:0,job:null,history:null,before:null,pages:[],downloading:false};
const amount=value=>Number(value||0).toLocaleString();
const file=name=>a.job?.result?.files?.find(item=>item.name===name);
const list=()=>a.plan?.[a.reviewKind]||[];
const planKey=()=>JSON.stringify((s.data?.jobs||[]).map(job=>[job.id,job.status]))+':'+$('archive-previous-backups').checked;
function archiveControls(){
 const unavailable=s.busy||!s.data;
 for(const name of ['archive-review','archive-previous-backups','archive-review-kind'])$(name).disabled=unavailable;
 $('archive-create').disabled=unavailable||Boolean(s.active)||!a.plan?.ready||a.plan.include_previous_backups!==$('archive-previous-backups').checked;
 $('archive-database-only').disabled=unavailable||Boolean(s.active);
 $('archive-resume').hidden=!a.job?.archive_availability?.can_resume;
 $('archive-resume').disabled=unavailable||Boolean(s.active);
 $('archive-cancel').hidden=a.job?.status!=='RUNNING';$('archive-cancel').disabled=unavailable;
 for(const name of ['archive-download','archive-manifest'])$(name).disabled=unavailable||a.downloading||!a.job?.archive_availability?.can_download;
 $('archive-review-prev').disabled=unavailable||a.reviewOffset===0;
 $('archive-review-next').disabled=unavailable||a.reviewOffset+25>=list().length;
 $('archive-history-prev').disabled=unavailable||!a.pages.length;
 $('archive-history-next').disabled=unavailable||a.history?.next_before==null;
}
function renderReview(){
 const box=$('archive-plan');box.replaceChildren();
 if(a.plan){
  fact(box,'Ready to export',a.plan.ready?'Yes':amount(a.plan.missing.length)+' files need to be restored to this workspace');
  fact(box,'Complete files',amount(a.plan.payload_files));fact(box,'Saved output jobs',amount(a.plan.outputs.length));
  fact(box,'Estimated input',amount(a.plan.payload_bytes+a.plan.database_bytes)+' bytes before compression');
  fact(box,'Workspace',a.plan.workspace_id);
 }else box.textContent='Reviewing the saved workspace contents…';
 const body=$('archive-review-rows');body.replaceChildren();
 for(const entry of list().slice(a.reviewOffset,a.reviewOffset+25)){
  const row=node('tr');cell(row,entry.kind||entry.reason||'File');cell(row,entry.path||entry.id,'code');body.append(row);
 }
 if(!list().length)empty(body,2,a.reviewKind==='outputs'?'The database is included. No completed external outputs are selected.':'No items in this selection.');
 $('archive-review-page').textContent=list().length?(a.reviewOffset+1)+'–'+Math.min(a.reviewOffset+25,list().length)+' of '+amount(list().length):'0 items';
 archiveControls();
}
async function review(){
 a.plan=await api('/api/workspace-archive-review?include_previous_backups='+$('archive-previous-backups').checked);
 a.planKey=planKey();
 a.reviewOffset=0;renderReview();
}
function renderHistory(){
 const body=$('archive-history');body.replaceChildren();
 for(const job of a.history?.items||[]){
  const row=node('tr');row.classList.toggle('selected',job.id===a.job?.id);
  cell(row,stamp(job.created_at));cell(row,job.status);
  cell(row,job.result?amount(job.result.payload_files)+' / '+amount(job.result.payload_bytes):'—');
  cell(row,job.id,'code');cell(row).append(button('Open',()=>open(job.id,job)));body.append(row);
 }
 if(!a.history?.items?.length)empty(body,5,'Create a complete backup to start the retained export history.');
 $('archive-history-page').textContent='History page '+(a.pages.length+1)+' · newest first';archiveControls();
}
async function history(before=a.before){
 const result=await api('/api/workspace-archives?limit=25'+(before==null?'':'&before='+before));
 a.history=result;a.before=before;renderHistory();
}
function renderJob(){
 const job=a.job;$('archive-selected').hidden=!job;if(!job){archiveControls();return;}
 const labels={RUNNING:'Creating the complete backup.',COMPLETE:'Complete backup ready to download.',CANCELLED:'Export cancelled. Resume this saved snapshot when ready.',INTERRUPTED:'The export was interrupted. Resume the same saved snapshot.',FAILED:'The export needs attention. Restore any required files, then resume this snapshot.'};
 $('archive-job-status').textContent=job.archive_availability?.reason||(labels[job.status]||job.status)+(job.error?' '+job.error:'');
 const facts=$('archive-job-facts');facts.replaceChildren();fact(facts,'Operation',job.id);fact(facts,'Created',stamp(job.created_at));
 if(job.result){fact(facts,'Complete files',amount(job.result.payload_files));fact(facts,'Original bytes',amount(job.result.payload_bytes));const zip=file('workspace.zip');fact(facts,'ZIP bytes',amount(zip?.bytes));fact(facts,'ZIP SHA-256',zip?.sha256);}
 const progress=job.progress;$('archive-progress').hidden=job.status!=='RUNNING';
 if(progress?.bytes_total){$('archive-progress').max=progress.bytes_total;$('archive-progress').value=Math.min(progress.bytes_done||0,progress.bytes_total);}
 else $('archive-progress').removeAttribute('value');
 $('archive-progress-text').textContent=progress?(progress.phase||job.status)+' · '+amount(progress.files_done)+' / '+amount(progress.files_total||job.result?.payload_files)+' files · '+amount(progress.bytes_done)+' bytes':'';
 const zip=file('workspace.zip');$('archive-receive-command').textContent=zip?
  'python -m stellar_forge_buyer.workspace_archive_receive inspect workspace.zip --sha256 '+zip.sha256+'\n\n'+
  'python -m stellar_forge_buyer.workspace_archive_receive receive workspace.zip ./restored-workspace --operation '+job.id+' --sha256 '+zip.sha256+'\n\n'+
  'python -m stellar_forge_buyer.analysis_workspace --database ./restored-workspace serve --open':'';
 archiveControls();
}
async function open(identifier,job){
 a.job=job||await api('/api/jobs/'+identifier);s.focusJob=identifier;renderJob();renderHistory();tab('archives');
 if(a.job.status==='RUNNING'){s.active=identifier;schedulePoll();}
}
function progress(job){if(job.kind!=='workspace-export')return;a.job=job;renderJob();}
function settled(job){if(job.kind!=='workspace-export')return;a.plan=null;progress(job);}
async function refreshArchives(){
 await history();if(!a.plan||a.planKey!==planKey())await review();
 if(a.job){a.job=await api('/api/jobs/'+a.job.id);renderJob();}
}
async function saveFile(name){
 const job=a.job,record=file(name);if(!record)throw Error('Select a completed workspace backup.');
 let handle=null;
 if(window.showSaveFilePicker){try{handle=await window.showSaveFilePicker({suggestedName:name});}catch(error){if(error.name==='AbortError')return;throw error;}}
 a.downloading=true;archiveControls();$('archive-download-state').textContent='Downloading '+amount(record.bytes)+' bytes…';
 let writable=null;
 try{
  const response=await fetch('/api/workspace-archives/'+job.id+'/files/'+encodeURIComponent(name),{headers:{'X-Analysis-Capability':capability},cache:'no-store'});
  if(!response.ok){const error=await response.json();throw Error(error.error||'Workspace download failed');}
  if(Number(response.headers.get('Content-Length'))!==record.bytes||response.headers.get('X-Content-SHA256')!==record.sha256){await response.body.cancel();throw Error('The selected backup file identity changed. Refresh and select it again.');}
  if(handle){
   writable=await handle.createWritable();const reader=response.body.getReader();let count=0;
   try{while(true){const {done,value}=await reader.read();if(done)break;count+=value.byteLength;await writable.write(value);$('archive-download-state').textContent='Saving '+amount(count)+' / '+amount(record.bytes)+' bytes…';}if(count!==record.bytes)throw Error('Workspace download was interrupted. The complete original export is still available.');await writable.close();writable=null;}
   finally{reader.releaseLock();}
  }else{
   if(record.bytes>64*1024*1024){await response.body.cancel();throw Error('Use the native archive download client for this '+amount(record.bytes)+'-byte backup, or a browser with direct file saving. The native client resumes interrupted downloads.');}
   const blob=await response.blob();if(blob.size!==record.bytes)throw Error('Workspace download was interrupted. Download the same retained backup again.');
   const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',await blob.arrayBuffer()))).map(value=>value.toString(16).padStart(2,'0')).join('');
   if(hash!==record.sha256)throw Error('Downloaded backup checksum did not match.');
   const url=URL.createObjectURL(blob),anchor=node('a');anchor.href=url;anchor.download=name;document.body.append(anchor);anchor.click();anchor.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  $('archive-download-state').textContent='Saved '+name+' · '+amount(record.bytes)+' bytes · SHA-256 '+record.sha256;
  message('Complete workspace file saved. Use the receiving command to reopen this backup.');
 }catch(error){if(writable)await writable.abort().catch(()=>{});$('archive-download-state').textContent=error.message;throw error;}
 finally{a.downloading=false;archiveControls();}
}
$('archive-review').addEventListener('click',()=>act(review));
$('archive-previous-backups').addEventListener('change',()=>act(async()=>{a.plan=null;renderReview();await review();}));
$('archive-create').addEventListener('click',()=>act(()=>start('workspace-export',{include_previous_backups:$('archive-previous-backups').checked})));
$('archive-database-only').addEventListener('click',()=>act(()=>start('backup',{})));
$('archive-cancel').addEventListener('click',()=>act(async()=>{await api('/api/workspace-archives/'+a.job.id+'/cancel',{});message('Cancellation requested. The saved snapshot can be resumed.');}));
$('archive-resume').addEventListener('click',()=>act(async()=>{const job=await api('/api/start/workspace-export',{id:a.job.id,...a.job.request});s.focusJob=job.id;s.active=job.status==='RUNNING'?job.id:null;progress(job);if(s.active)schedulePoll();else await completed(job);message('Reconnected to the same saved workspace backup.');}));
$('archive-download').addEventListener('click',()=>act(()=>saveFile('workspace.zip')));
$('archive-manifest').addEventListener('click',()=>act(()=>saveFile('archive-manifest.json')));
$('archive-review-kind').addEventListener('change',()=>{a.reviewKind=$('archive-review-kind').value;a.reviewOffset=0;renderReview();});
$('archive-review-prev').addEventListener('click',()=>{a.reviewOffset=Math.max(0,a.reviewOffset-25);renderReview();});
$('archive-review-next').addEventListener('click',()=>{a.reviewOffset+=25;renderReview();});
$('archive-history-next').addEventListener('click',()=>act(async()=>{const prior=a.before;await history(a.history.next_before);a.pages.push(prior);renderHistory();}));
$('archive-history-prev').addEventListener('click',()=>act(async()=>{await history(a.pages.at(-1));a.pages.pop();renderHistory();}));
window.workspaceArchives={controls:archiveControls,refresh:refreshArchives,progress,settled,open,show:async()=>{tab('archives');await review();}};
})();
'''
