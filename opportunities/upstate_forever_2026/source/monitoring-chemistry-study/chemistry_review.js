/* Offline analyst review of retained Chemistry outputs. Scientific records stay untouched. */
(() => {
  'use strict';
  const q = s => document.querySelector(s);
  const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const metadata = JSON.parse(q('#chemistry-review-binding').textContent);
  const modes = ['calibration', 'sensitivity', 'uncertainty', 'monitoring'];
  const statuses = {open:'Open', checked:'Reviewed', follow_up:'Follow up'};
  const records = new Map();
  const sourceRows = [];
  const stable = value => JSON.stringify(value, (_, v) => v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.keys(v).sort().map(k => [k,v[k]])) : v);
  function add(mode, observation, raw, parameter='') {
    const key = JSON.stringify([mode, observation.id, parameter]);
    if (records.has(key)) throw new Error('Duplicate original review target: '+key);
    const row = {key, analysis:mode, record_id:observation.id, parameter, reach:observation.reach,
      day:observation.day, measurement:observation.measurement, source:raw};
    records.set(key,row); sourceRows.push(row);
  }
  DATA.chemistry.results.calibration.observations.forEach(r => add('calibration',r,r));
  DATA.chemistry.results.sensitivity.rows.forEach(r => r.derivatives.forEach(d => add('sensitivity',r.observation,{observation:r.observation,predicted_mg_l:r.predicted_mg_l,derivative:d},d.parameter)));
  DATA.chemistry.results.uncertainty.summaries.forEach(r => add('uncertainty',r.observation,r));
  DATA.chemistry.results.monitoring.selected.forEach(r => add('monitoring',r.candidate,r));
  const uuid = () => typeof crypto.randomUUID === 'function' ? crypto.randomUUID() : [...crypto.getRandomValues(new Uint8Array(16))].map(v=>v.toString(16).padStart(2,'0')).join('');
  const blank = () => ({schema:'upstate.chemistry-analyst-review/v1',binding:metadata,
    document_id:'study-'+metadata.study_data_sha256,revision:0,reviewer:'',entries:{},conflicts:[],
    view:{analysis:'calibration',reach:'',measurement:'',query:'',status:'',parameter:''}});
  const semantic = e => stable({status:e.status,note:e.note,reviewer:e.reviewer});
  function validEntry(key, e) {
    if (!records.has(key) || !e || typeof e !== 'object' || Array.isArray(e) ||
        !Object.hasOwn(statuses,e.status) || typeof e.note !== 'string' ||
        typeof e.reviewer !== 'string' || typeof e.edited_at !== 'string' ||
        Number.isNaN(Date.parse(e.edited_at))) throw new Error('Invalid or unknown review record: '+key);
    return {status:e.status,note:e.note,reviewer:e.reviewer,edited_at:e.edited_at};
  }
  function validate(value) {
    if (!value || value.schema !== 'upstate.chemistry-analyst-review/v1' ||
        stable(value.binding) !== stable(metadata)) throw new Error('This review belongs to a different original Chemistry study.');
    if (typeof value.document_id !== 'string' || !/^[a-zA-Z0-9-]{1,100}$/.test(value.document_id) ||
        !Number.isSafeInteger(value.revision) || value.revision < 0 || typeof value.reviewer !== 'string' ||
        !value.entries || typeof value.entries !== 'object' || Array.isArray(value.entries) ||
        !Array.isArray(value.conflicts)) throw new Error('The review file is incomplete.');
    const output = {...value,entries:{},conflicts:[]};
    for (const [key,entry] of Object.entries(value.entries)) output.entries[key] = validEntry(key,entry);
    for (const conflict of value.conflicts) {
      if (!conflict || typeof conflict.key !== 'string') throw new Error('Invalid returned-review conflict.');
      output.conflicts.push({key:conflict.key,incoming:validEntry(conflict.key,conflict.incoming)});
    }
    output.view = {...blankView(),...(value.view || {})};
    for (const v of Object.values(output.view)) if (typeof v !== 'string') throw new Error('Invalid saved review view.');
    if (!modes.includes(output.view.analysis)) throw new Error('Unknown saved Chemistry analysis.');
    if (output.view.status && !Object.hasOwn(statuses,output.view.status)) throw new Error('Unknown saved review status.');
    return output;
  }
  function blankView() { return {analysis:'calibration',reach:'',measurement:'',query:'',status:'',parameter:''}; }
  let startupError = '', state;
  try { state = q('#chemistry-review-state') ? validate(JSON.parse(q('#chemistry-review-state').textContent)) : blank(); }
  catch (error) { startupError = error.message+' Original results remain available; export the supplied page before starting a new review.'; state=blank(); }
  const copyPrefix='eco-chemistry-review:'+metadata.study_data_sha256+':';
  const pointerKey=copyPrefix+'window-pointer';
  function validateDraft(value) {
    if(value===null||value===undefined)return null;
    if(!value||!records.has(value.key)||typeof value.note!=='string'||!Object.hasOwn(statuses,value.status)||typeof value.dirty!=='boolean')
      throw new Error('The retained unfinished note is invalid.');
    return {key:value.key,note:value.note,status:value.status,dirty:value.dirty};
  }
  let restoredDraft=null;
  try{const original=q('#chemistry-review-entered');if(original)restoredDraft=validateDraft(JSON.parse(original.textContent))}
  catch(error){startupError+=' '+error.message+' Keep the original supplied HTML.'}
  const openingIdentity=stable({review:state,draft:restoredDraft});
  let copyId=uuid(),copyCreated=new Date().toISOString(),retentionPending=false,lastOfferedSignature=null,acknowledgedSignature=null;
  function decodeCopy(raw,key='') {
    const value=JSON.parse(raw);
    if(value?.schema==='upstate.chemistry-working-copy/v1'){
      if(typeof value.copy_id!=='string'||typeof value.origin!=='string'||typeof value.updated_at!=='string')
        throw new Error('The saved working copy is incomplete.');
      return {key,copy_id:value.copy_id,origin:value.origin,review:validate(value.review),
        draft:validateDraft(value.draft),updated_at:value.updated_at};
    }
    const review=validate(value);
    return {key,copy_id:'legacy',origin:null,review,draft:null,updated_at:''};
  }
  if(!startupError){
    try{
      const pointer=JSON.parse(sessionStorage.getItem(pointerKey)||'null');
      if(pointer?.origin===openingIdentity&&typeof pointer.key==='string'&&pointer.key.startsWith(copyPrefix+'working:')){
        const raw=localStorage.getItem(pointer.key);
        if(raw){const saved=decodeCopy(raw,pointer.key);if(saved.origin===openingIdentity){state=saved.review;restoredDraft=saved.draft}}
      }
    }catch(error){startupError='Automatic window reopening is unavailable. Saved browser copies can be opened explicitly; the supplied HTML remains intact.'}
  }
  let activeKey = null, dirty = false, importSerial = 0;
  q('#chemistry-review-ui')?.remove(); q('#chemistry-review-dialog')?.remove();
  const panel=document.createElement('div'); panel.id='chemistry-review-ui'; panel.className='card long-card';
  panel.innerHTML=`<h2>Analyst review and handover</h2>
    <p class="sub">Review the original authored four-reach method study. Notes and review decisions are saved separately from the completed numerical analyses.</p>
    <div class="controls"><label>Reviewer<input id="cr-reviewer" type="text" autocomplete="off"></label>
      <label>Find a record<input id="cr-query" type="search" placeholder="Identifier, reach, compound or note"></label>
      <label>Review status<select id="cr-status"><option value="">All statuses</option><option value="open">Open</option><option value="checked">Reviewed</option><option value="follow_up">Follow up</option></select></label>
      <label id="cr-parameter-label" hidden>Parameter<select id="cr-parameter"><option value="">All parameters</option></select></label></div>
    <p id="cr-count" class="sub"></p><p id="cr-status-message" role="status" class="message" aria-live="polite"></p>
    <div class="actions"><button id="cr-save-html">Save working HTML</button><button id="cr-export-json">Export review JSON</button>
      <button id="cr-import-button">Import returned review</button><input id="cr-import" type="file" accept=".json,application/json" hidden>
      <button id="cr-export-csv">Export visible data CSV</button><button id="cr-export-data">Export visible data JSON</button>
      <button id="cr-export-report">Export review report</button></div>
    <div class="controls"><label>Retained browser working copies<select id="cr-local-copy"><option value="">Choose a saved copy</option></select></label>
      <button id="cr-refresh-copies">Refresh copies</button><button id="cr-open-copy">Open a separate copy</button>
      <button id="cr-download-copy">Download selected copy JSON</button></div>
    <p class="sub">Each open window keeps a separate complete working copy. Opening an earlier copy preserves the current one. Downloaded working HTML includes unfinished notes; ordinary returned-review JSON contains committed reviews.</p>
    <button id="cr-ack-copy" hidden>I saved the complete working HTML</button>
    <p class="sub">CSV and JSON include full stored numeric values for the visible records. Save working HTML keeps this review, original reports and all original downloads in one offline file.</p>
    <div id="cr-conflicts" hidden></div><div class="table-wrap" tabindex="0" role="region" aria-label="Chemistry analyst review records">
    <table class="cr-table"><thead><tr><th>Record / parameter</th><th>Reach / day</th><th>Measurement</th><th>Review</th><th>Note</th></tr></thead><tbody id="cr-records"></tbody></table></div>
    <details><summary>Original study and numerical identity</summary><p class="provenance" id="cr-binding"></p><p class="sub">Review exchanges require the same retained study data. Each analysis keeps its original calibration roles, intervals, parameter units and model provenance. Budget-plan selections remain a separate regional decision.</p></details>`;
  const numericalCard=q('#chemical-table-title').closest('.card');
  numericalCard.parentNode.insertBefore(panel,numericalCard);
  const dialog=document.createElement('dialog'); dialog.id='chemistry-review-dialog';
  dialog.innerHTML=`<form id="cr-edit-form"><div class="dialog-head"><h2 id="cr-record-title">Review record</h2><button type="button" id="cr-close">Close</button></div>
    <div class="cr-dialog-body"><p id="cr-record-context" class="sub"></p><div class="controls"><label>Decision<select id="cr-edit-status"><option value="open">Open</option><option value="checked">Reviewed</option><option value="follow_up">Follow up</option></select></label></div>
    <label class="cr-note-label">Analyst note<textarea id="cr-edit-note" rows="5"></textarea></label><div class="actions"><button type="submit">Save review</button></div>
    <p id="cr-edit-message" role="status" class="message"></p><details open><summary>Full original numerical record and source context</summary><pre id="cr-raw-record"></pre></details></div></form>`;
  document.body.append(dialog);
  q('#cr-binding').textContent=`Case ${metadata.case_id} | Engine ${metadata.engine_version} | Project ${metadata.project_id} | Study data SHA-256 ${metadata.study_data_sha256}`;
  q('#cr-reviewer').value=state.reviewer;
  q('#cr-query').value=state.view.query; q('#cr-status').value=state.view.status;
  const parameters=[...new Set(sourceRows.map(r=>r.parameter).filter(Boolean))];
  q('#cr-parameter').insertAdjacentHTML('beforeend',parameters.map(p=>`<option value="${escape(p)}">${escape(p)}</option>`).join(''));
  q('#cr-parameter').value=state.view.parameter;
  function entry(key) { return state.entries[key] || {status:'open',note:'',reviewer:'',edited_at:''}; }
  function message(text) { q('#cr-status-message').textContent=text; }
  function captureView() {
    state.reviewer=q('#cr-reviewer').value;
    state.view={analysis:q('#analysis').value,reach:q('#reach').value,measurement:q('#operator').value,
      query:q('#cr-query').value,status:q('#cr-status').value,parameter:q('#cr-parameter').value};
  }
  function enteredDraft(){
    return activeKey ? {key:activeKey,note:q('#cr-edit-note').value,status:q('#cr-edit-status').value,dirty} : null;
  }
  function workingSignature(){return stable({review:state,draft:enteredDraft()})}
  function retainWorking(text='Review saved in this window. Export a working HTML for a portable copy.'){
    captureView();
    const key=copyPrefix+'working:'+copyId;
    const saved={schema:'upstate.chemistry-working-copy/v1',copy_id:copyId,origin:openingIdentity,
      created_at:copyCreated,updated_at:new Date().toISOString(),review:JSON.parse(JSON.stringify(state)),draft:enteredDraft()};
    try{
      localStorage.setItem(key,JSON.stringify(saved));
      retentionPending=false;q('#cr-ack-copy').hidden=true;
      try{sessionStorage.setItem(pointerKey,JSON.stringify({key,origin:openingIdentity}))}
      catch(error){text+=' Automatic window reopening is unavailable; use Retained browser working copies.'}
      if(text)message(text);return true;
    }catch(error){
      retentionPending=true;q('#cr-ack-copy').hidden=false;
      message('This complete working copy remains only in this open page. Save working HTML, then acknowledge the saved file before leaving or opening another copy.');
      return false;
    }
  }
  function persist(text){state.revision++;retainWorking(text)}
  function refreshCopies(){
    const selected=q('#cr-local-copy').value,rows=[];
    try{
      for(let i=0;i<localStorage.length;i++){
        const key=localStorage.key(i);if(!key||!key.startsWith(copyPrefix))continue;
        const raw=localStorage.getItem(key);if(!raw)continue;
        try{const value=decodeCopy(raw,key);rows.push(value)}catch(error){}
      }
      rows.sort((a,b)=>b.updated_at.localeCompare(a.updated_at)||a.key.localeCompare(b.key));
      q('#cr-local-copy').innerHTML='<option value="">Choose a saved copy</option>'+rows.map(value=>
        '<option value="'+escape(value.key)+'">'+escape((value.review.reviewer||'Unnamed reviewer')+' · revision '+value.review.revision+
        (value.updated_at?' · '+value.updated_at:' · original browser copy')+(value.draft?.dirty?' · unfinished note':'')+
        (value.copy_id===copyId?' · this window':''))+'</option>').join('');
      if(rows.some(value=>value.key===selected))q('#cr-local-copy').value=selected;
      return rows;
    }catch(error){message('Saved browser copies cannot be listed here. Keep or download the complete open working HTML.');return []}
  }
  function applyReviewView(draft=null){
    q('#cr-reviewer').value=state.reviewer;q('#cr-query').value=state.view.query;q('#cr-status').value=state.view.status;
    q('#cr-parameter').value=state.view.parameter;q('#analysis').value=state.view.analysis;
    q('#reach').value=state.view.reach;q('#operator').value=state.view.measurement;
    updateChemistry();render();
    if(draft){openRecord(draft.key);q('#cr-edit-note').value=draft.note;q('#cr-edit-status').value=draft.status;dirty=draft.dirty}
  }
  function openSavedCopy(){
    try{
      const key=q('#cr-local-copy').value;
      if(!key||!key.startsWith(copyPrefix))throw new Error('Choose a retained working copy.');
      const raw=localStorage.getItem(key);if(!raw)throw new Error('The selected copy is no longer available.');
      const selected=decodeCopy(raw,key);
      if(!retainWorking('')&&acknowledgedSignature!==workingSignature())throw new Error('Save and acknowledge the complete current working HTML before opening another copy.');
      importSerial++;dialog.close();activeKey=null;dirty=false;state=selected.review;
      copyId=uuid();copyCreated=new Date().toISOString();acknowledgedSignature=null;lastOfferedSignature=null;
      applyReviewView(selected.draft);retainWorking('Opened a separate copy. The previous and selected originals remain retained.');refreshCopies();
    }catch(error){message(error.message)}
  }
  q('#cr-refresh-copies').addEventListener('click',refreshCopies);
  q('#cr-open-copy').addEventListener('click',openSavedCopy);
  q('#cr-download-copy').addEventListener('click',()=>{
    try{const key=q('#cr-local-copy').value;if(!key||!key.startsWith(copyPrefix))throw new Error('Choose a retained working copy.');
      const raw=localStorage.getItem(key);if(!raw)throw new Error('The selected copy is unavailable.');decodeCopy(raw,key);
      saveFile('Chemistry_Retained_Working_Copy.json',raw,'application/json');
    }catch(error){message(error.message)}
  });
  q('#cr-ack-copy').addEventListener('click',()=>{
    if(lastOfferedSignature!==workingSignature()){message('Save the current complete working HTML first; an older file does not include the latest edits.');return}
    acknowledgedSignature=lastOfferedSignature;message('The current complete working file is acknowledged. Later changes will require a new saved file.');
  });

  function visible() {
    const query=q('#cr-query').value.toLowerCase();
    return sourceRows.filter(r=>r.analysis===q('#analysis').value &&
      (!q('#reach').value || r.reach===q('#reach').value) && (!q('#operator').value || r.measurement===q('#operator').value) &&
      (!q('#cr-status').value || entry(r.key).status===q('#cr-status').value) &&
      (r.analysis!=='sensitivity' || !q('#cr-parameter').value || r.parameter===q('#cr-parameter').value) &&
      (!query || [r.record_id,r.parameter,r.reach,r.measurement,entry(r.key).note,entry(r.key).reviewer].join(' ').toLowerCase().includes(query)));
  }
  function render() {
    const rows=visible(), marks=Object.values(state.entries);
    q('#cr-count').textContent=`${rows.length} visible records. Whole study: ${marks.filter(e=>e.status==='checked').length} reviewed, ${marks.filter(e=>e.status==='follow_up').length} follow-up, ${sourceRows.length-marks.filter(e=>e.status!=='open').length} open. ${state.conflicts.length} returned-review conflicts.`;
    q('#cr-parameter-label').hidden=q('#analysis').value!=='sensitivity';
    q('#cr-records').innerHTML=rows.map((r,i)=>`<tr><td>${escape(r.record_id)}<br><button data-cr-edit="${i}">Review</button>${r.parameter?'<br><span class="sub">'+escape(r.parameter)+'</span>':''}</td><td>${escape(r.reach)}<br><span class="sub">Day ${escape(r.day)}</span></td><td>${escape(r.measurement)}</td><td>${statuses[entry(r.key).status]}</td><td class="cr-note-preview">${escape(entry(r.key).note)||'<span class="sub">No note</span>'}</td></tr>`).join('') || '<tr><td colspan="5" class="empty">No records match this view. Clear the search or review filter.</td></tr>';
    q('#cr-records').querySelectorAll('[data-cr-edit]').forEach(b=>b.addEventListener('click',()=>openRecord(rows[Number(b.dataset.crEdit)].key)));
    renderConflicts();
  }
  function openRecord(key) {
    const row=records.get(key); activeKey=key; dirty=false;
    q('#cr-record-title').textContent=row.record_id+(row.parameter?' / '+row.parameter:'');
    q('#cr-record-context').textContent=`${row.analysis} | ${row.reach} | day ${row.day} | ${row.measurement}`;
    q('#cr-edit-status').value=entry(key).status; q('#cr-edit-note').value=entry(key).note;
    q('#cr-raw-record').textContent=JSON.stringify(row.source,null,2); q('#cr-edit-message').textContent='';
    dialog.showModal(); q('#cr-edit-note').focus();retainWorking('');
  }
  function closeRecord() { if (dirty && !confirm('Discard the unsaved note in this dialog?')) return; dialog.close(); activeKey=null; dirty=false;retainWorking(''); }
  q('#cr-close').addEventListener('click',closeRecord);
  dialog.addEventListener('cancel',event=>{event.preventDefault();closeRecord();});
  q('#cr-edit-note').addEventListener('input',()=>{dirty=true;retainWorking('')}); q('#cr-edit-status').addEventListener('change',()=>{dirty=true;retainWorking('')});
  q('#cr-edit-form').addEventListener('submit',event=>{
    event.preventDefault(); if (!activeKey) return;
    state.entries[activeKey]={status:q('#cr-edit-status').value,note:q('#cr-edit-note').value,reviewer:q('#cr-reviewer').value,edited_at:new Date().toISOString()};
    dirty=false;dialog.close();activeKey=null;persist();render();
  });
  function renderConflicts() {
    const target=q('#cr-conflicts'); target.hidden=!state.conflicts.length;
    target.innerHTML=state.conflicts.length?`<h3>Resolve returned reviews</h3><p>Both versions remain available until you choose which note to keep for each record.</p>`+state.conflicts.map((c,i)=>{
      const r=records.get(c.key),local=entry(c.key);
      return `<div class="cr-conflict"><strong>${escape(r.analysis+' / '+r.record_id+(r.parameter?' / '+r.parameter:''))}</strong><div class="two-col"><div><h4>Current review</h4><p>${statuses[local.status]} · ${escape(local.reviewer)}</p><pre>${escape(local.note)}</pre></div><div><h4>Returned review</h4><p>${statuses[c.incoming.status]} · ${escape(c.incoming.reviewer)}</p><pre>${escape(c.incoming.note)}</pre></div></div><div class="actions"><button data-keep="${i}">Keep current</button><button data-take="${i}">Use returned</button></div></div>`;
    }).join(''):'';
    target.querySelectorAll('[data-keep],[data-take]').forEach(b=>b.addEventListener('click',()=>{
      const take=b.hasAttribute('data-take'),index=Number(take?b.dataset.take:b.dataset.keep),conflict=state.conflicts[index];
      if (take) state.entries[conflict.key]={...conflict.incoming};
      state.conflicts.splice(index,1);persist('Returned-review choice saved.');render();
    }));
  }
  function saveFile(name,content,type) {
    const a=document.createElement('a'),url=URL.createObjectURL(new Blob([content],{type}));
    a.href=url;a.download=name;document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);
    message('Downloaded '+name);
  }
  function snapshot() { captureView(); return JSON.parse(JSON.stringify(state)); }
  const inlineJSON=value=>JSON.stringify(value).replace(/</g,'\\u003c');
  q('#cr-save-html').addEventListener('click',()=>{
    const saved=snapshot(),clone=document.documentElement.cloneNode(true);
    clone.querySelector('#chemistry-review-state')?.remove();clone.querySelector('#chemistry-review-entered')?.remove();
    clone.querySelector('#chemistry-review-ui')?.remove();clone.querySelector('#chemistry-review-dialog')?.remove();
    clone.querySelectorAll('dialog[open]').forEach(d=>d.removeAttribute('open'));
    const frame=clone.querySelector('#report-frame');if(frame)frame.removeAttribute('srcdoc');
    const script=document.createElement('script');script.id='chemistry-review-state';script.type='application/json';script.textContent=inlineJSON(saved);
    clone.querySelector('#chemistry-review-extension').before(script);
    const entered=document.createElement('script');entered.id='chemistry-review-entered';entered.type='application/json';entered.textContent=inlineJSON(enteredDraft());clone.querySelector('#chemistry-review-extension').before(entered);
    lastOfferedSignature=workingSignature();
    saveFile('Ecosystem_Chemistry_Working_Review.html','<!doctype html>\n'+clone.outerHTML,'text/html;charset=utf-8');
  });
  q('#cr-export-json').addEventListener('click',()=>saveFile('Chemistry_Analyst_Review.json',JSON.stringify(snapshot(),null,2),'application/json'));
  function exportedRows() { return visible().map(r=>({analysis:r.analysis,record_id:r.record_id,parameter:r.parameter,reach:r.reach,day:r.day,measurement:r.measurement,review:{...entry(r.key)},original:r.source})); }
  function flatten(value,path='',out={}) {
    if (value && typeof value==='object' && !Array.isArray(value)) for (const [key,item] of Object.entries(value)) flatten(item,path?path+'.'+key:key,out);
    else out[path]=Array.isArray(value)?JSON.stringify(value):value;
    return out;
  }
  function cell(value) {
    if (value===null || value===undefined) return '';
    let text=String(value);if(typeof value==='string' && /^[\s]*[=+\-@]|^[\t\r]/.test(text))text="'"+text;
    return '"'+text.replace(/"/g,'""')+'"';
  }
  q('#cr-export-data').addEventListener('click',()=>saveFile('Chemistry_Visible_Review_Data.json',JSON.stringify({schema:'upstate.chemistry-review-data/v1',binding:metadata,view:snapshot().view,rows:exportedRows()},null,2),'application/json'));
  q('#cr-export-csv').addEventListener('click',()=>{
    const rows=exportedRows().map(r=>flatten(r)),fields=[...new Set(rows.flatMap(r=>Object.keys(r)))];
    if(!fields.length)fields.push('analysis','record_id','parameter','reach','day','measurement','review.status','review.note');
    saveFile('Chemistry_Visible_Review_Data.csv','\ufeff'+[fields.map(cell).join(','),...rows.map(r=>fields.map(f=>cell(r[f])).join(','))].join('\r\n')+'\r\n','text/csv;charset=utf-8');
  });
  q('#cr-export-report').addEventListener('click',()=>{
    const rows=exportedRows(),saved=snapshot();
    const body=`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Chemistry analyst review</title><style>body{font:16px Arial,sans-serif;line-height:1.5;max-width:1000px;margin:32px auto;padding:0 20px;color:#222}h1{font-size:28px}h2{font-size:19px}article{border-top:1px solid #aaa;padding:16px 0;break-inside:avoid}pre{white-space:pre-wrap;overflow-wrap:anywhere;font-size:12px;background:#f3f3f3;padding:12px}.note{white-space:pre-wrap;overflow-wrap:anywhere}.meta{font-size:13px;overflow-wrap:anywhere}@media print{body{margin:0;max-width:none}article{break-inside:auto}}</style><h1>Compound Chemistry: analyst review</h1><p>${rows.length} records in the saved ${escape(saved.view.analysis)} view. Reviewer: ${escape(saved.reviewer)||'Unspecified'}.</p><p class="meta">Case ${escape(metadata.case_id)}<br>Original study data SHA-256 ${metadata.study_data_sha256}<br>Review revision ${saved.revision}; ${state.conflicts.length} unresolved returned-review conflicts.</p><p>Original authored four-reach method study. Review decisions accompany the numerical records without changing the completed analyses. The portable working HTML carries the full native reports and editable project.</p>`+
      rows.map(r=>`<article><h2>${escape(r.record_id)}${r.parameter?' / '+escape(r.parameter):''}</h2><p>${escape(r.reach)} · day ${escape(r.day)} · ${escape(r.measurement)}</p><p><strong>${statuses[r.review.status]}</strong> · ${escape(r.review.reviewer)||'No reviewer'}${r.review.edited_at?' · '+escape(r.review.edited_at):''}</p><p class="note">${escape(r.review.note)||'No analyst note.'}</p><details><summary>Original full-precision numerical record</summary><pre>${escape(JSON.stringify(r.original,null,2))}</pre></details></article>`).join('')+'<script id="retained-review" type="application/json">'+inlineJSON({binding:metadata,review:saved,rows})+'<\/script></html>';
    saveFile('Chemistry_Analyst_Review_Report.html',body,'text/html;charset=utf-8');
  });
  q('#cr-import-button').addEventListener('click',()=>{importSerial++;q('#cr-import').value='';q('#cr-import').click()});
  q('#cr-import').addEventListener('change',async()=>{
    const file=q('#cr-import').files[0]; if(!file)return;
    const serial=++importSerial,receivingCopy=copyId;q('#cr-import').value='';
    const active=()=>serial===importSerial&&receivingCopy===copyId;
    try {
      const original=await file.text();if(!active())return;
      const supplied=JSON.parse(original),incoming=supplied?.schema==='upstate.chemistry-working-copy/v1'?decodeCopy(original).review:validate(supplied);
      if(incoming.conflicts.length)throw new Error('Resolve the returned file’s pending conflicts in its working HTML before importing it.');
      if(state.conflicts.length)throw new Error('Resolve the current pending conflicts before importing another review.');
      const entries={...state.entries},conflicts=[];let additions=0;
      for (const [key,value] of Object.entries(incoming.entries)) {
        if (!Object.hasOwn(entries,key)) {entries[key]={...value};additions++;}
        else if(semantic(entries[key])!==semantic(value))conflicts.push({key,incoming:{...value}});
      }
      state.entries=entries;state.conflicts=conflicts;
      state.received_reviews=[...(Array.isArray(state.received_reviews)?state.received_reviews:[]),{id:uuid(),name:file.name||'',received_at:new Date().toISOString(),content:original}];
      persist(`Imported ${additions} new reviews; ${conflicts.length} conflicting records need your choice.`);render();
    } catch(error) { if(active())message('Review import: '+error.message); }
  });
  for(const selector of ['#analysis','#reach','#operator'])q(selector).addEventListener('change',()=>{persist('Review view saved.');render();});
  for(const selector of ['#cr-query','#cr-status','#cr-parameter'])q(selector).addEventListener(selector==='#cr-query'?'input':'change',()=>{persist('Review view saved.');render();});
  q('#cr-reviewer').addEventListener('input',()=>retainWorking(''));
  q('#cr-reviewer').addEventListener('change',()=>persist());
  q('#analysis').value=state.view.analysis;q('#reach').value=state.view.reach;q('#operator').value=state.view.measurement;
  updateChemistry();render();
  if(restoredDraft){applyReviewView(restoredDraft)}
  retainWorking('');refreshCopies();
  if(state.revision || Object.keys(state.entries).length)showTab('chemistry');
  if(!retentionPending){if(startupError)message(startupError);else if(state.revision)message('Saved analyst review reopened. Original numerical results and downloads are available.');}
  window.addEventListener('beforeunload',event=>{if(dirty||(retentionPending&&acknowledgedSignature!==workingSignature())){event.preventDefault();event.returnValue='';}});
})();
