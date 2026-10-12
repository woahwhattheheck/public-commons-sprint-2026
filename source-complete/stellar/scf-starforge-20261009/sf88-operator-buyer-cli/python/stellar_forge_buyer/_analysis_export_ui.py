"""Complete query-export controls within the original customer workspace."""

HTML = r'''
<section id="tab-exports" hidden>
<section class="panel">
  <div class="section-head"><div><h2>Export a complete query</h2><p>Select a retained analysis review. The export runs its exact SQL and parameters over the reviewed data selection.</p></div><button id="full-export-choose">Choose an analysis</button></div>
  <div class="form-row"><label for="full-export-query">Retained query review<select id="full-export-query"><option value="">Choose a completed analysis</option></select></label><button id="full-export-use-result">Use the selected analysis result</button></div>
  <div id="full-export-review" hidden>
    <div id="full-export-review-facts" class="facts"></div>
    <p class="hint">Every row returned by this SQL statement is included. Any SQL LIMIT and the original source's acquisition scope still apply.</p>
    <details open><summary>SQL and parameters</summary><pre id="full-export-sql"></pre><pre id="full-export-parameters"></pre></details>
    <details><summary>Reviewed data versions and original source context</summary><pre id="full-export-review-context"></pre></details>
  </div>
  <form id="full-export-form">
    <label for="full-export-label">Export name <span class="muted">Optional</span><input id="full-export-label" maxlength="160" autocomplete="off" placeholder="Current inventory for operations"></label>
    <fieldset><legend>Output files</legend><div class="key-options full-export-formats">
      <label><input type="checkbox" name="full-export-format" value="jsonl" checked>JSONL</label>
      <label><input type="checkbox" name="full-export-format" value="csv" checked>CSV</label>
      <label><input type="checkbox" name="full-export-format" value="sqlite" checked>SQLite</label>
    </div><p class="hint">The selected files share one query run and retain the same row order. A manifest records the query, source versions and file hashes.</p></fieldset>
    <div class="grid full-export-limits">
      <label for="full-export-timeout">Execution timeout, seconds<input id="full-export-timeout" type="number" min="1" max="86400" step="1" value="300" required></label>
      <label for="full-export-max-rows">Maximum export rows <span class="muted">Optional</span><input id="full-export-max-rows" type="number" min="1" step="1" placeholder="All rows returned by the query"></label>
      <label for="full-export-max-bytes">Maximum output bytes <span class="muted">Optional</span><input id="full-export-max-bytes" type="number" min="1" step="1" placeholder="Combined size of selected files"></label>
    </div>
    <p class="hint">Leave optional limits empty to consume the complete query. Exceeding a chosen limit ends the export with an error; the retained history records the outcome.</p>
    <div class="key-options"><label><input id="full-export-safe-csv" type="checkbox" checked>Prepare CSV text for spreadsheet import</label></div>
    <p class="hint">Spreadsheet import prefixes formula-like text with an apostrophe. Clear this option to keep literal CSV text. SQLite preserves native scalar values; JSONL retains typed values.</p>
    <button id="full-export-run" class="primary" type="submit">Export every query row</button>
  </form>
</section>
<section id="full-export-progress" class="panel" hidden aria-labelledby="full-export-progress-title">
  <div class="section-head"><div><h2 id="full-export-progress-title">Export in progress</h2><p id="full-export-progress-name"></p></div><button id="full-export-cancel">Cancel export</button></div>
  <progress id="full-export-progress-bar" aria-label="Query export progress"></progress>
  <div id="full-export-progress-facts" class="facts" role="status" aria-live="polite" aria-atomic="true"></div>
  <p id="full-export-progress-note" class="hint"></p>
</section>
<section class="panel">
  <div class="section-head"><div><h2>Retained export history</h2><p>Open a saved export to inspect its manifest and download its original files.</p></div><div class="toolbar"><button id="full-export-history-refresh">Refresh exports</button><button id="full-export-history-prev">Newer exports</button><button id="full-export-history-next">Older exports</button></div></div>
  <div class="table-scroll"><table><thead><tr><th>Started</th><th>Export</th><th>Status</th><th>Rows</th><th>Output</th><th></th></tr></thead><tbody id="full-export-history"></tbody></table></div>
  <p id="full-export-history-page" class="muted"></p>
</section>
<section id="full-export-detail" class="panel" hidden aria-labelledby="full-export-detail-title">
  <div class="section-head"><div><h2 id="full-export-detail-title">Selected export</h2><p id="full-export-detail-label"></p></div><button id="full-export-reuse">Use this query review again</button></div>
  <div id="full-export-detail-facts" class="facts"></div><p id="full-export-outcome" class="notice" role="status"></p>
  <div id="full-export-complete" hidden>
    <div class="table-scroll"><table><thead><tr><th>File</th><th>Bytes</th><th>SHA-256</th><th></th></tr></thead><tbody id="full-export-files"></tbody></table></div>
    <p class="hint">Downloads use the original retained files. The result database's result table preserves query order through _sf_export_row.</p>
    <details open><summary>Executed SQL and parameters</summary><pre id="full-export-result-sql"></pre><pre id="full-export-result-parameters"></pre></details>
    <details><summary>Original source context and query review</summary><pre id="full-export-result-context"></pre></details>
    <details><summary>Complete export manifest</summary><pre id="full-export-manifest"></pre></details>
  </div>
</section>
</section>
'''

CSS = r'''
#tab-exports input[type=checkbox]{width:auto;margin:0}
#tab-exports .full-export-limits{grid-template-columns:repeat(3,minmax(0,1fr));gap:16px;margin-top:14px}
#full-export-form{margin-top:18px;border-top:1px solid #ccc;padding-top:16px}
#full-export-form>label{max-width:720px}
#full-export-progress-bar{width:100%;height:12px;accent-color:#555;margin:7px 0 10px}
#full-export-files td.code{max-width:440px;min-width:180px;overflow-wrap:anywhere}
#full-export-history td:nth-child(2){min-width:160px;max-width:380px;overflow-wrap:anywhere}
#full-export-outcome{font-weight:400;overflow-wrap:anywhere}
#full-export-detail-label,#full-export-progress-name{overflow-wrap:anywhere}
#full-export-review-context,#full-export-result-context,#full-export-manifest{max-height:430px}
@media(max-width:760px){#tab-exports .full-export-limits{grid-template-columns:1fr;gap:0}#full-export-run{width:100%}#full-export-files td.code{min-width:170px}#tab-exports .facts b{display:block;min-width:0}}
'''

JS = r'''

window.customerExports=(()=>{
  const x={review:null,reviewPending:false,active:null,selected:null,history:null,before:null,pages:[],reviewLoad:0,detailLoad:0,historyLoad:0,workspace:null,restored:false};
  const options=['full-export-label','full-export-timeout','full-export-max-rows','full-export-max-bytes','full-export-safe-csv'];
  const pretty=value=>JSON.stringify(value,null,2);
  const key=suffix=>'sf-query-export:'+s.data.workspace_id+':'+suffix;
  const title=job=>job.request?.label||job.label||job.request?.name||'Query export';
  const units=value=>Number.isFinite(value)?new Intl.NumberFormat().format(value):'—';
  const bytes=value=>Number.isFinite(value)?units(value)+' bytes':'—';
  const queryLabel=job=>(job.request?.name||'Analysis')+' · '+stamp(job.finished_at)+' · '+short(job.id);
  function selectedFormats(){return [...document.querySelectorAll('[name="full-export-format"]:checked')].map(input=>input.value);}
  function optionValues(){return {label:$('full-export-label').value,timeout:$('full-export-timeout').value,max_rows:$('full-export-max-rows').value,max_output_bytes:$('full-export-max-bytes').value,spreadsheet_safe:$('full-export-safe-csv').checked,formats:selectedFormats()};}
  function rememberOptions(){if(s.data)try{localStorage.setItem(key('options'),JSON.stringify(optionValues()));}catch{}controls();}
  function restoreOptions(){
    let value;try{value=JSON.parse(localStorage.getItem(key('options')));}catch{}
    if(!value||typeof value!=='object')return;
    for(const [field,name]of [['full-export-label','label'],['full-export-timeout','timeout'],['full-export-max-rows','max_rows'],['full-export-max-bytes','max_output_bytes']])if(typeof value[name]==='string')$(field).value=value[name];
    if(typeof value.spreadsheet_safe==='boolean')$('full-export-safe-csv').checked=value.spreadsheet_safe;
    if(Array.isArray(value.formats))for(const input of document.querySelectorAll('[name="full-export-format"]'))input.checked=value.formats.includes(input.value);
  }
  function queryOptions(){
    const queries=new Map((s.data?.jobs||[]).filter(job=>job.kind==='query'&&job.status==='COMPLETE').map(job=>[job.id,job]));
    for(const job of [s.result,x.review])if(job?.kind==='query'&&job.status==='COMPLETE')queries.set(job.id,job);
    const select=$('full-export-query');select.replaceChildren();const blank=node('option','Choose a completed analysis');blank.value='';select.append(blank);
    for(const job of queries.values()){const option=node('option',queryLabel(job));option.value=job.id;select.append(option);}
    select.value=x.review?.id||'';
  }
  function renderReview(){
    const job=x.review;$('full-export-review').hidden=!job;
    if(!job){controls();return;}
    const box=$('full-export-review-facts');box.replaceChildren();
    fact(box,'Analysis',job.request.name||'Retained SQL analysis');fact(box,'Review',job.id);fact(box,'Completed',stamp(job.finished_at));
    fact(box,'Preview rows',job.result.total_rows??job.result.rows?.length??0);fact(box,'Preview limited',job.result.truncated?'Yes':'No');
    $('full-export-sql').textContent=job.request.sql;
    $('full-export-parameters').textContent=job.request.parameters_text;
    $('full-export-review-context').textContent=pretty({query_id:job.id,result_sha256:job.result.result_sha256,reviewed_views:job.result.views,read_tables:job.result.read_tables,source_versions:job.result.source_versions});
    controls();
  }
  async function review(query){
    const sequence=++x.reviewLoad;let job;
    try{job=typeof query==='string'?await api('/api/jobs/'+encodeURIComponent(query)):query;}
    catch(error){if(sequence===x.reviewLoad)queryOptions();throw error;}
    if(sequence!==x.reviewLoad)return;
    if(job?.kind!=='query'||job.status!=='COMPLETE'||!job.result?.result_sha256)throw Error('Choose a completed analysis review before exporting.');
    x.review=job;queryOptions();renderReview();tab('exports');
    message('Query review selected. Choose output files and export limits.');
  }
  async function reviewEditor(){
    x.reviewPending=true;
    try{await start('query',{...editorValue(),expected_views:s.data.views});}
    catch(error){x.reviewPending=false;throw error;}
  }
  async function queryReady(job){if(x.reviewPending){x.reviewPending=false;await review(job);}else queryOptions();}
  function integer(field,{optional=false,max=Number.MAX_SAFE_INTEGER}={}){
    const raw=$(field).value.trim();if(optional&&!raw)return null;
    const value=Number(raw);if(!raw||!Number.isSafeInteger(value)||value<1||value>max)throw Error($(field).closest('label').childNodes[0].textContent.trim()+' must be a positive whole number'+(max===86400?' through 86400.':'.'));
    return value;
  }
  async function begin(){
    const job=x.review;if(!job)throw Error('Choose a completed analysis review.');
    const formats=selectedFormats();if(!formats.length)throw Error('Choose at least one output file format.');
    rememberOptions();
    await start('query-export',{query_id:job.id,result_sha256:job.result.result_sha256,label:$('full-export-label').value.trim(),formats,timeout:integer('full-export-timeout',{max:86400}),max_rows:integer('full-export-max-rows',{optional:true}),max_output_bytes:integer('full-export-max-bytes',{optional:true}),spreadsheet_safe:$('full-export-safe-csv').checked});
    tab('exports');
  }
  function controls(){
    const unavailable=s.busy||!s.data;
    for(const id of ['full-export-choose','full-export-query','full-export-use-result','full-export-history-refresh','full-export-history-prev','full-export-history-next','full-export-reuse','full-export-run','full-export-cancel','full-export-from-result','full-export-review-editor'])$(id).disabled=unavailable;
    for(const input of document.querySelectorAll('#full-export-form input'))input.disabled=unavailable;
    $('full-export-run').disabled||=Boolean(s.active)||!x.review||!selectedFormats().length;
    $('full-export-review-editor').disabled||=Boolean(s.active);
    $('full-export-from-result').disabled||=s.result?.status!=='COMPLETE';
    $('full-export-use-result').disabled||=s.result?.status!=='COMPLETE';
    $('full-export-history-prev').disabled||=!x.pages.length;
    $('full-export-history-next').disabled||=x.history?.next_before==null;
    $('full-export-reuse').disabled||=!x.selected?.request?.query_id;
    $('full-export-cancel').disabled||=x.active?.status!=='RUNNING'||Boolean(x.active?.progress?.cancel_requested);
    for(const button of document.querySelectorAll('#full-export-files button,#full-export-history button'))button.disabled=unavailable;
  }
  function renderActive(){
    const job=x.active;$('full-export-progress').hidden=job?.status!=='RUNNING';
    if(!job)return;
    $('full-export-progress-name').textContent=title(job)+' · '+job.id;
    $('full-export-progress-title').textContent=job.progress?.cancel_requested?'Cancelling export':'Export in progress';
    const box=$('full-export-progress-facts');box.replaceChildren();
    fact(box,'Rows written',units(job.progress?.rows??0));fact(box,'Output written',bytes(job.progress?.outputBytes??0));fact(box,'Updated',stamp(job.progress?.updated_at||job.created_at));
    $('full-export-progress-note').textContent=job.progress?.cancel_requested?'Cancellation is recorded. The query will stop at its next cancellation check.':'The query reports rows and output bytes as it writes. You can continue viewing saved data while it runs.';
    $('full-export-progress-bar').removeAttribute('value');controls();
  }
  function progress(job){
    if(job.kind!=='query-export')return;
    if(job.status==='RUNNING')x.active=job;else if(x.active?.id===job.id)x.active=null;
    if(x.selected?.id===job.id||!x.selected&&s.focusJob===job.id){x.selected=job;renderDetail();}
    renderActive();
    const row=document.querySelector('#full-export-history tr[data-export="'+job.id+'"]');
    if(row){row.children[2].textContent=job.status+(job.progress?.cancel_requested?' · cancellation requested':'');row.children[3].textContent=units(job.result?.manifest?.rowCount??job.progress?.rows);row.children[4].textContent=bytes(job.progress?.outputBytes);}
  }
  function settled(job){if(job.kind==='query'&&job.status!=='COMPLETE')x.reviewPending=false;progress(job);}
  async function cancel(){
    const job=x.active;if(job?.status!=='RUNNING')return;
    const value=await api('/api/query-exports/'+job.id+'/cancel',{});progress(value);
    message(value.status==='RUNNING'?'Cancellation requested for the current export.':'Export '+value.status.toLowerCase()+'.');
    if(value.status!=='RUNNING')await completed(value);
  }
  async function history(before=x.before,pages=x.pages){
    const sequence=++x.historyLoad,value=await api('/api/query-exports'+(before==null?'':'?before='+encodeURIComponent(before)));
    if(sequence!==x.historyLoad)return;
    x.history=value;x.before=before;x.pages=pages;
    const body=$('full-export-history');body.replaceChildren();
    for(const job of value.items){
      const row=node('tr');row.dataset.export=job.id;row.classList.toggle('selected',job.id===x.selected?.id);
      cell(row,stamp(job.created_at));const name=cell(row,job.label||short(job.id));name.title=job.id;
      cell(row,job.status+(job.progress?.cancel_requested&&job.status==='RUNNING'?' · cancellation requested':'')+(job.error?' · '+job.error:''));
      cell(row,units(job.row_count??job.progress?.rows));cell(row,bytes(job.output_bytes??job.progress?.outputBytes));cell(row).append(button('Open',()=>open(job.id)));body.append(row);
    }
    if(!value.items.length)empty(body,6,'No exports on this page. Complete a query review and choose its output files above.');
    $('full-export-history-page').textContent='History page '+(x.pages.length+1)+' · '+value.items.length+' exports shown · newest first';controls();
  }
  function renderDetail(){
    const job=x.selected;$('full-export-detail').hidden=!job;if(!job)return;
    $('full-export-detail-label').textContent=title(job)+' · '+job.id;
    const box=$('full-export-detail-facts');box.replaceChildren();
    fact(box,'Status',job.status);fact(box,'Started',stamp(job.created_at));fact(box,'Finished',stamp(job.finished_at));fact(box,'Query review',job.request.query_id);
    fact(box,'Selected formats',job.request.formats.join(', '));fact(box,'Execution timeout',job.request.timeout+' seconds');
    fact(box,'Maximum rows',job.request.max_rows==null?'No additional limit':units(job.request.max_rows));fact(box,'Maximum output',job.request.max_output_bytes==null?'No additional limit':bytes(job.request.max_output_bytes));
    const result=job.status==='COMPLETE'?job.result:null;$('full-export-complete').hidden=!result;
    $('full-export-outcome').textContent=result?'Complete query · '+units(result.manifest.rowCount)+' rows · '+units(result.files.length)+' retained files. The executed SQL and original source scope are recorded below.':job.status==='RUNNING'?job.progress?.cancel_requested?'Cancellation requested. Waiting for the query to stop.':'Writing the complete query result. Progress appears above.':job.status==='CANCELLED'?'Export cancelled. Its original query review remains available for another export.':job.status==='INTERRUPTED'?'The workspace stopped during this export. Reopen its query review to start another export.':job.error||'This export did not complete.';
    if(result){
      fact(box,'Rows',units(result.manifest.rowCount));fact(box,'Retained directory',result.directory);fact(box,'Manifest SHA-256',result.manifest_sha256);
      const files=$('full-export-files');files.replaceChildren();
      for(const file of result.files){const row=node('tr');cell(row,file.name,'code');cell(row,units(file.bytes));cell(row,file.sha256,'code');cell(row).append(button('Download',()=>downloadFile(job,file)));files.append(row);}
      $('full-export-result-sql').textContent=result.manifest.binding.sql;
      $('full-export-result-parameters').textContent=result.source_query.parameters_text;
      $('full-export-result-context').textContent=pretty({source_query:result.source_query,queryComplete:result.manifest.queryComplete,reviewed_views:result.manifest.binding.views,read_tables:result.manifest.binding.readTables,source_versions:result.manifest.binding.sourceVersions});
      $('full-export-manifest').textContent=result.manifest_text;
    }
    for(const row of document.querySelectorAll('#full-export-history tr[data-export]'))row.classList.toggle('selected',row.dataset.export===job.id);
    controls();
  }
  async function open(jobId,original){
    const sequence=++x.detailLoad,job=original||await api('/api/jobs/'+encodeURIComponent(jobId));
    if(sequence!==x.detailLoad)return;
    if(job.kind!=='query-export')throw Error('Choose a retained query export.');
    x.selected=job;s.focusJob=job.id;try{localStorage.setItem(key('selected'),job.id);}catch{}
    renderDetail();progress(job);tab('exports');
    if(job.status==='RUNNING'){s.active=job.id;schedulePoll();}
  }
  async function downloadFile(job,file){
    let handle=null;
    if(window.showSaveFilePicker){try{handle=await window.showSaveFilePicker({suggestedName:file.name});}catch(error){if(error.name==='AbortError')return;throw error;}}
    else if(file.bytes>64*1024*1024)throw Error('This browser can save files up to 64 MiB. Use a browser with streaming file save, or copy the complete retained file from '+job.result.directory+'/'+file.name+'.');
    const response=await fetch('/api/query-exports/'+job.id+'/file?name='+encodeURIComponent(file.name),{headers:{'X-Analysis-Capability':capability},cache:'no-store'});
    if(!response.ok){const error=await response.json();throw Error(error.error||'Export download failed');}
    if(handle){const writable=await handle.createWritable();try{await response.body.pipeTo(writable);}catch(error){await writable.abort().catch(()=>{});throw error;}}
    else{const blob=await response.blob(),url=URL.createObjectURL(blob),anchor=node('a');anchor.href=url;anchor.download=file.name;document.body.append(anchor);anchor.click();anchor.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);}
    message('Saved '+file.name+' · '+bytes(file.bytes)+' · SHA-256 '+file.sha256);
  }
  async function refresh(){
    if(x.workspace!==s.data.workspace_id){x.workspace=s.data.workspace_id;x.restored=false;restoreOptions();}
    queryOptions();await history();
    if(!x.restored){
      x.restored=true;let selected;try{selected=localStorage.getItem(key('selected'));}catch{}
      if(selected&&/^[a-f0-9]{32}$/.test(selected)){
        const job=await api('/api/jobs/'+encodeURIComponent(selected));
        if(job.kind==='query-export'){x.selected=job;renderDetail();progress(job);}
      }
    }
    const running=s.data.jobs.find(job=>job.kind==='query-export'&&job.status==='RUNNING');
    if(running){const job=await api('/api/jobs/'+running.id);progress(job);}
    else if(x.active){const job=await api('/api/jobs/'+x.active.id);progress(job);}
    controls();
  }
  $('full-export-form').addEventListener('submit',event=>{event.preventDefault();act(begin);});
  $('full-export-choose').addEventListener('click',()=>{tab('analysis');$('saved-query').focus();});
  $('full-export-review-editor').addEventListener('click',()=>act(reviewEditor));
  $('full-export-from-result').addEventListener('click',()=>act(()=>review(s.result)));
  $('full-export-use-result').addEventListener('click',()=>act(()=>review(s.result)));
  $('full-export-query').addEventListener('change',()=>act(async()=>{const value=$('full-export-query').value;if(value)await review(value);else{x.review=null;renderReview();}}));
  $('full-export-reuse').addEventListener('click',()=>act(()=>review(x.selected.request.query_id)));
  $('full-export-cancel').addEventListener('click',()=>act(cancel));
  $('full-export-history-refresh').addEventListener('click',()=>act(()=>history(null,[])));
  $('full-export-history-next').addEventListener('click',()=>act(()=>history(x.history.next_before,[...x.pages,x.before])));
  $('full-export-history-prev').addEventListener('click',()=>act(()=>history(x.pages.at(-1),x.pages.slice(0,-1))));
  for(const field of options)$(field).addEventListener('input',rememberOptions);
  for(const input of document.querySelectorAll('[name="full-export-format"]'))input.addEventListener('change',rememberOptions);
  return {controls,refresh,open,progress,settled,queryReady,review};
})();
'''
