"""Packaged report editor, retained publications and downloads for the customer UI."""

HTML = r'''
<section id="tab-reports" hidden>
<section class="panel"><div class="section-head"><div><h2>Customer reports</h2><p>Compose saved analyses into a complete report. Every section reads the same reviewed data selection.</p></div><button id="report-new">New report</button></div>
<div class="form-row"><label>Saved report<select id="report-saved"><option value="">Unsaved report</option></select></label><label>Definition revision<select id="report-revision"><option value="">—</option></select></label><label>Save as<input id="report-name" autocomplete="off" spellcheck="false" placeholder="inventory_review"></label></div>
<p id="report-editor-state" class="muted"></p><label for="report-title">Report title</label><input id="report-title" maxlength="300" placeholder="Inventory review"><label for="report-introduction">Introduction</label><textarea id="report-introduction" rows="3" maxlength="16000" placeholder="Purpose, reporting scope and the decisions this report supports."></textarea>
<div class="section-head"><h3>Ordered report sections</h3><button id="report-add-section">Add saved analysis</button></div><p id="report-query-help" class="hint">Save SQL analyses in Analysis first. Each report section retains its chosen query revision and effective parameters.</p><div id="report-sections"></div>
<div class="toolbar"><button id="report-save">Save report definition</button><button id="report-run" class="primary">Run saved report</button><button id="report-review-views">Use current data selection</button></div><p id="report-review-state" class="muted"></p><details><summary>Reviewed current views</summary><pre id="report-reviewed-views"></pre></details>
</section>
<section id="report-result" class="panel" hidden><div class="section-head"><div><h2 id="report-result-title">Retained report</h2><p id="report-result-info"></p></div><div class="toolbar"><button id="report-result-refresh">Refresh report state</button><label>Report section<select id="report-result-section"></select></label></div></div>
<p id="report-result-introduction"></p><h3 id="report-section-title"></h3><p id="report-section-note"></p><div class="table-scroll"><table id="report-result-table"><thead></thead><tbody></tbody></table></div><div class="section-head"><p id="report-result-page" class="muted"></p><div class="toolbar"><button id="report-result-prev">Previous rows</button><button id="report-result-next">Next rows</button></div></div>
<details><summary>Original data, query and retained report</summary><p>Source filters, projections and ordering remain part of each acquired edition.</p><pre id="report-result-binding"></pre></details>
<div class="review-choice"><h2>Publish a report edition</h2><p>Keep an explicit, named version of this completed report. Publishing saves it in this private workspace; you choose which exported file to share.</p><p id="report-publication-state"></p><label for="report-publication-note">Review and handover note</label><textarea id="report-publication-note" rows="3" maxlength="16000" placeholder="Record the conclusion, intended use and any context the recipient needs."></textarea><button id="report-publish" class="primary">Publish this report edition</button></div>
<div id="report-export" class="review-choice" hidden><h2>Published report downloads</h2><label>Retained publication<select id="report-export-publication"></select></label><p id="report-export-info"></p><div class="toolbar"><button id="report-export-html">Prepare printable HTML</button><button id="report-export-json">Prepare complete JSON</button><button id="report-export-csv">Prepare CSV bundle</button></div><p class="hint">The CSV ZIP includes every section, the full typed JSON and printable HTML. Original data selection and review identity remain attached.</p></div>
<div id="report-download-area" class="review-choice" hidden><h2>Prepared download</h2><p id="report-download-info"></p><button id="report-download">Download report file</button></div>
</section>
<section class="panel"><div class="section-head"><div><h2>Report runs</h2><p>Earlier results remain available when saved SQL, report definitions or current data selections change.</p></div><div class="toolbar"><button id="report-history-prev">Newer runs</button><button id="report-history-next">Older runs</button></div></div><div class="table-scroll"><table><thead><tr><th>Started</th><th>Report / definition</th><th>Status</th><th>Rows</th><th></th></tr></thead><tbody id="report-history"></tbody></table></div></section>
<section class="panel"><div class="section-head"><div><h2>Publication history</h2><p>A publication is tied to its original completed report and review note.</p></div><div class="toolbar"><button id="report-publications-prev">Newer editions</button><button id="report-publications-next">Older editions</button></div></div><div class="table-scroll"><table><thead><tr><th>Published</th><th>Report</th><th>Edition</th><th>Review</th><th></th></tr></thead><tbody id="report-publications"></tbody></table></div></section>
</section>
'''

CSS = r'''
.report-section{padding:14px;border:1px solid #bdbdbd;margin:12px 0;background:#fafafa}
.report-section h3{margin:0;font-size:14px}.report-section .section-head{margin-bottom:8px}
.report-section textarea{background:#fff}.report-section .query-source{margin-bottom:12px}
#report-editor-state,#report-review-state{min-height:18px}
#report-result-table td{white-space:pre-wrap;overflow-wrap:anywhere;max-width:450px;min-width:90px}
#report-result-table .null{color:#777;font-style:italic}#report-result-table .number{text-align:right;font-variant-numeric:tabular-nums}
#report-result-introduction,#report-section-note,#report-export-info{white-space:pre-wrap}
#report-download-info{overflow-wrap:anywhere}
#report-sections>.notice{font-weight:400}#report-result h3{margin:18px 0 8px}
#report-publication-note{max-width:1000px}.report-section input[type=number]{max-width:160px}
'''

JS = r'''
(() => {
'use strict';
const r={loaded:null,editor:{name:'',title:'',introduction:'',sections:[]},base:'',draftLoaded:false,views:null,
 result:null,resultLoad:0,publication:null,download:null,history:null,historyBefore:null,historyPages:[],
 publications:null,publicationsBefore:null,publicationsPages:[],savePending:null,publishPending:null};
const copy=value=>JSON.parse(JSON.stringify(value));
const value=()=>({name:$('report-name').value.trim(),title:$('report-title').value,introduction:$('report-introduction').value,
 sections:r.editor.sections.map(section=>({title:section.title,note:section.note,query_name:section.query_name,
 query_revision:section.query_revision,parameters_text:section.parameters_text}))});
const key=()=>JSON.stringify(value());
const dirty=()=>key()!==r.base;
const sameName=()=>r.loaded&&r.loaded.definition.name===$('report-name').value.trim();
function draftKey(){return 'sf-analysis-report-draft:'+s.data.workspace_id;}
function saveDraft(){
 if(!s.data)return;
 const current=value();r.editor={...r.editor,...current,sections:r.editor.sections};
 try{localStorage.setItem(draftKey(),JSON.stringify({editor:r.editor,loaded:r.loaded,base:r.base,views:r.views,savePending:r.savePending}));}catch{}
 editorLabel();
}
function editorLabel(){
 if(!$('report-name'))return;
 $('report-editor-state').textContent=(sameName()?'Loaded definition '+r.loaded.definition.revision+
  '; next save compares current revision '+r.loaded.head_revision+'.':'New saved report.')+(dirty()?' Unsaved changes.':'');
 const changed=r.views!==null&&JSON.stringify(r.views)!==JSON.stringify(s.data?.views);
 $('report-review-state').textContent=r.views===null?'Choose the current data selection before running.':
  changed?'The current data selection changed. Use current data selection to review it before running.':
  'Every section will use this reviewed data selection in one transaction. A report requires complete section results.';
 $('report-reviewed-views').textContent=JSON.stringify(r.views,null,2);
}
function queryOptions(select,selected){
 select.replaceChildren();
 for(const q of s.data?.queries||[]){const option=node('option',q.name+' · current revision '+q.revision);option.value=q.name;select.append(option);}
 if(selected&&!Array.from(select.options).some(o=>o.value===selected)){const option=node('option',selected);option.value=selected;select.append(option);}
 if(!select.options.length){const option=node('option','No saved analyses');option.value='';select.append(option);}
 select.value=selected||select.options[0]?.value||'';
}
function input(labelText,tag,current,change){
 const label=node('label',labelText),field=document.createElement(tag);
 field.value=current??'';if(tag==='textarea')field.rows=3;
 field.addEventListener('input',()=>{change(field.value);saveDraft();controls();});
 label.append(field);return [label,field];
}
function renderSections(){
 const box=$('report-sections');box.replaceChildren();
 if(!r.editor.sections.length){box.append(node('p','Add one or more saved analyses. Each section keeps a title, context, selected query revision and parameters.','notice'));return;}
 r.editor.sections.forEach((section,index)=>{
  const card=node('section',undefined,'report-section'),head=node('div',undefined,'section-head'),tools=node('div',undefined,'toolbar');
  head.append(node('h3','Section '+(index+1)));
  const up=button('Move up',()=>{[r.editor.sections[index-1],r.editor.sections[index]]=[r.editor.sections[index],r.editor.sections[index-1]];renderSections();saveDraft();});up.disabled=index===0;up.dataset.reportMove='up';up.dataset.index=index;
  const down=button('Move down',()=>{[r.editor.sections[index+1],r.editor.sections[index]]=[r.editor.sections[index],r.editor.sections[index+1]];renderSections();saveDraft();});down.disabled=index===r.editor.sections.length-1;down.dataset.reportMove='down';down.dataset.index=index;
  tools.append(up,down,button('Remove',()=>{r.editor.sections.splice(index,1);renderSections();saveDraft();}));head.append(tools);card.append(head);
  const [titleLabel,titleInput]=input('Section title','input',section.title,v=>section.title=v);titleInput.maxLength=300;card.append(titleLabel);
  const row=node('div',undefined,'form-row'),queryLabel=node('label','Saved analysis'),querySelect=document.createElement('select');
  queryOptions(querySelect,section.query_name);queryLabel.append(querySelect);
  querySelect.addEventListener('change',()=>act(async()=>{await replaceQuery(index,querySelect.value);}));
  const revisionLabel=node('label','Query revision'),revisionSelect=document.createElement('select');
  const revisions=section.query_history||[{revision:section.query_revision}];
  for(const h of revisions){const option=node('option','Revision '+h.revision);option.value=h.revision;revisionSelect.append(option);}
  revisionSelect.value=String(section.query_revision);revisionSelect.addEventListener('change',()=>act(async()=>{await replaceQuery(index,section.query_name,Number(revisionSelect.value),true);}));
  revisionLabel.append(revisionSelect);row.append(queryLabel,revisionLabel,button('Load current query revision',async()=>{await replaceQuery(index,section.query_name,undefined,true);}));card.append(row);
  const [noteLabel,noteInput]=input('Section context','textarea',section.note,v=>section.note=v);noteInput.maxLength=8000;card.append(noteLabel);
  const [paramsLabel,paramsInput]=input('Effective parameters · JSON array or object','textarea',section.parameters_text,v=>section.parameters_text=v);paramsInput.spellcheck=false;card.append(paramsLabel);
  const details=node('details',undefined,'query-source');details.append(node('summary','Pinned SQL and original recipe'));
  details.append(node('pre',JSON.stringify({query_name:section.query_name,query_revision:section.query_revision,query:section.query},null,2)));card.append(details);
  box.append(card);
 });
}
async function replaceQuery(index,name,revision,keepContext=false){
 if(!name)throw Error('Save an analysis first.');
 const original=r.editor.sections[index],generation=r.editor;
 const query=await api('/api/queries/'+encodeURIComponent(name)+(revision?'?revision='+revision:''));
 if(r.editor!==generation||r.editor.sections[index]!==original)return;
 r.editor.sections[index]={title:keepContext?original.title:name,note:keepContext?original.note:'',
  query_name:query.name,query_revision:query.revision,parameters_text:query.parameters_text,
  query:{sql:query.sql,parameters_text:query.parameters_text,max_rows:query.max_rows,name:query.name,revision:query.revision,saved_at:query.saved_at},
  query_history:query.history};
 renderSections();saveDraft();
}
async function addSection(){
 const q=s.data?.queries[0];if(!q)throw Error('Save an analysis in the Analysis tab first.');
 if(r.editor.sections.length>=12)throw Error('A report supports up to 12 complete sections.');
 const query=await api('/api/queries/'+encodeURIComponent(q.name));
 r.editor.sections.push({title:q.name,note:'',query_name:q.name,query_revision:query.revision,
 parameters_text:query.parameters_text,query:{sql:query.sql,parameters_text:query.parameters_text,max_rows:query.max_rows,
 name:query.name,revision:query.revision,saved_at:query.saved_at},query_history:query.history});
 renderSections();saveDraft();
}
function renderSaved(){
 const select=$('report-saved'),old=select.value;select.replaceChildren();
 const blank=node('option','Unsaved report');blank.value='';select.append(blank);
 for(const report of s.data?.reports||[]){const option=node('option',report.title+' · '+report.name);option.value=report.name;select.append(option);}
 select.value=sameName()?r.loaded.definition.name:old;
 const revision=$('report-revision');revision.replaceChildren();
 if(r.loaded){for(const h of r.loaded.history){const option=node('option','Revision '+h.revision);option.value=h.revision;revision.append(option);}revision.value=String(r.loaded.definition.revision);}
 else revision.append(node('option','—'));
}
function setEditor(editor,loaded=null){
 r.editor=copy(editor);r.loaded=loaded;
 $('report-name').value=editor.name||'';$('report-title').value=editor.title||'';$('report-introduction').value=editor.introduction||'';
 renderSections();renderSaved();r.base=key();saveDraft();
}
function canReplaceEditor(){return !dirty()||confirm('Discard the unsaved report definition changes?');}
async function loadDefinition(name,revision){
 if(!name)return;
 if(!canReplaceEditor()){$('report-saved').value=r.loaded?.definition.name||'';$('report-revision').value=r.loaded?.definition.revision||'';return;}
 const loaded=await api('/api/reports/'+encodeURIComponent(name)+(revision?'?revision='+revision:''));
 r.views=copy(s.data.views);r.savePending=null;setEditor(loaded.definition,loaded);
 message('Loaded '+name+' report definition '+loaded.definition.revision+'.');
}
async function saveDefinition(){
 const current=value();if(!current.name)throw Error('Enter a report name.');
 const spec={...current,expected_revision:sameName()?r.loaded.head_revision:0};delete spec.name;
 const requestKey=JSON.stringify({name:current.name,spec});
 if(r.savePending?.key!==requestKey)r.savePending={key:requestKey,request:{id:id(),...spec}};
 saveDraft();
 const saved=await api('/api/reports/'+encodeURIComponent(current.name),r.savePending.request);
 const loaded=await api('/api/reports/'+encodeURIComponent(current.name)+'?revision='+saved.revision);
 r.savePending=null;setEditor(loaded.definition,loaded);await refresh();
 message('Report definition '+saved.revision+' saved with every selected query revision.');
}
function reviewViews(){r.views=copy(s.data.views);saveDraft();message('Current data selection loaded for this report. Review the retained view list before running.');}
async function runReport(){
 if(!r.loaded||!sameName()||dirty())throw Error('Save the complete report definition before running.');
 if(r.views===null)throw Error('Use current data selection before running.');
 await start('report',{name:r.loaded.definition.name,revision:r.loaded.definition.revision,
  definition_sha256:r.loaded.sha256,expected_views:r.views});
}
function reportNoteKey(jobId){return 'sf-analysis-report-note:'+s.data.workspace_id+':'+jobId;}
function storeNote(){if(r.result&&s.data)try{localStorage.setItem(reportNoteKey(r.result.report.job_id),$('report-publication-note').value);}catch{}}
function loadNote(){
 const jobId=r.result.report.job_id;let saved=null;try{saved=localStorage.getItem(reportNoteKey(jobId));}catch{}
 $('report-publication-note').value=saved===null?(r.publication?.publication.note||''):saved;
}
function renderPublication(){
 const result=r.result;if(!result)return;
 const publications=result.publications,select=$('report-export-publication');select.replaceChildren();
 for(const item of publications){const pub=item.publication,option=node('option','Edition '+pub.revision+' · '+stamp(pub.published_at));option.value=pub.id;select.append(option);}
 if(r.publication&&publications.some(item=>item.publication.id===r.publication.publication.id))select.value=r.publication.publication.id;
 else{r.publication=publications[0]||null;select.value=r.publication?.publication.id||'';}
 $('report-export').hidden=!r.publication;
 $('report-publication-state').textContent='Current publication revision for '+result.report.definition.name+': '+
  result.publication_revision+'. This action will retain edition '+(result.publication_revision+1)+' of the selected completed report.';
 if(r.publication){const pub=r.publication.publication;$('report-export-info').textContent='Edition '+pub.revision+' · '+stamp(pub.published_at)+'\n'+(pub.note||'No additional publication note.');}
}
function renderResult(){
 const result=r.result;if(!result)return;const report=result.report,section=result.section;
 $('report-result').hidden=false;$('report-result-title').textContent=report.definition.title;
 $('report-result-info').textContent=stamp(report.completed_at)+' · '+report.sections.length+' sections · '+report.total_rows+
  ' complete rows · definition '+report.definition.revision;
 $('report-result-introduction').textContent=report.definition.introduction;$('report-section-title').textContent=section.title;
 $('report-section-note').textContent=section.note;
 const select=$('report-result-section');select.replaceChildren();
 for(const part of report.sections){const option=node('option',(part.ordinal+1)+'. '+part.title+' · '+part.row_count+' rows');option.value=part.ordinal;select.append(option);}select.value=String(section.ordinal);
 const table=$('report-result-table');table.tHead.replaceChildren();table.tBodies[0].replaceChildren();const heading=node('tr');
 for(const label of section.columns)heading.append(node('th',label));table.tHead.append(heading);
 for(const values of result.rows){const row=node('tr');for(const value of values){const td=cell(row,value.type==='null'?'NULL':value.text);td.classList.toggle('null',value.type==='null');td.classList.toggle('number',['integer','number'].includes(value.type));td.title=value.type;}table.tBodies[0].append(row);}
 if(!result.rows.length)empty(table.tBodies[0],Math.max(1,section.columns.length),'No rows in this section.');
 $('report-result-page').textContent=section.row_count?'Rows '+(result.offset+1)+'–'+(result.offset+result.rows.length)+' of '+section.row_count:'0 rows';
 $('report-result-binding').textContent=JSON.stringify({job_id:report.job_id,definition_sha256:report.definition_sha256,
 result_sha256:report.result_sha256,views:report.views,sources:report.sources,data_reviews:report.data_reviews,section,recipe:report.definition.sections[section.ordinal]},null,2);
 renderPublication();controls();
}
async function openReport(jobId,publicationId){
 const sequence=++r.resultLoad,result=await api('/api/report-runs/'+jobId);
 if(sequence!==r.resultLoad)return;
 const same=r.result?.report.job_id===jobId;r.result=result;
 r.publication=result.publications.find(item=>item.publication.id===(publicationId||r.publication?.publication.id))||result.publications[0]||null;
 if(!same){r.download=null;$('report-download-area').hidden=true;r.publishPending=null;}
 renderResult();loadNote();tab('reports');
}
async function resultPage(section,offset){
 if(!r.result)return;const jobId=r.result.report.job_id,sequence=++r.resultLoad;
 const result=await api('/api/report-runs/'+jobId+'?section='+section+'&offset='+offset);
 if(sequence!==r.resultLoad||r.result?.report.job_id!==jobId)return;r.result=result;renderResult();
}
async function publishReport(){
 if(!r.result)throw Error('Open a completed report first.');
 const report=r.result.report,spec={result_sha256:report.result_sha256,expected_revision:r.result.publication_revision,note:$('report-publication-note').value};
 const requestKey=JSON.stringify({jobId:report.job_id,spec});
 const reuse=r.publishPending?.jobId===report.job_id&&r.publishPending.request.result_sha256===report.result_sha256&&r.publishPending.request.note===spec.note;
 if(!reuse)r.publishPending={jobId:report.job_id,key:requestKey,request:{id:id(),...spec}};
 try{localStorage.setItem('sf-analysis-report-publication:'+s.data.workspace_id,JSON.stringify({jobId:report.job_id,...r.publishPending}));}catch{}
 let publication;
 try{publication=await api('/api/report-runs/'+report.job_id+'/publish',r.publishPending.request);}
 catch(error){if(error.status>=400&&error.status<500){r.publishPending=null;try{localStorage.removeItem('sf-analysis-report-publication:'+s.data.workspace_id);}catch{}}throw error;}
 r.publishPending=null;try{localStorage.removeItem('sf-analysis-report-publication:'+s.data.workspace_id);}catch{}
 await openReport(report.job_id,publication.id);await refresh();
 message('Published '+publication.name+' edition '+publication.revision+' in this private workspace.');
}
async function exportReport(format){
 if(!r.publication)throw Error('Choose a retained publication first.');
 await start('report-export',{publication_id:r.publication.publication.id,publication_sha256:r.publication.sha256,format});
}
async function exportReady(job){
 const publicationId=job.result.publication_id;
 if(r.result?.report.job_id!==job.result.job_id)await openReport(job.result.job_id,publicationId);
 else if(r.result.publications.some(item=>item.publication.id===publicationId)){r.publication=r.result.publications.find(item=>item.publication.id===publicationId);renderPublication();}
 r.download=job;$('report-download-area').hidden=false;
 $('report-download-info').textContent=job.result.format.toUpperCase()+' · '+job.result.bytes.toLocaleString()+' bytes · '+job.result.filename;
 tab('reports');message('Complete report file prepared. Download it below.');controls();
}
async function downloadReport(){
 const job=r.download;if(!job)throw Error('Prepare a report download first.');
 const suggested=job.result.filename;let destination=null;
 if(typeof window.showSaveFilePicker==='function'){try{destination=await window.showSaveFilePicker({suggestedName:suggested});}catch(error){if(error.name==='AbortError')return;throw error;}}
 const response=await fetch('/api/report-export/'+job.id,{headers:{'X-Analysis-Capability':capability},cache:'no-store'});
 if(!response.ok){const result=await response.json();throw Error(result.error||'Download failed');}
 if(destination){const output=await destination.createWritable();try{await response.body.pipeTo(output);}catch(error){try{await output.abort();}catch{}throw error;}message('Complete report file saved.');return;}
 const length=Number(response.headers.get('Content-Length'));
 if(!Number.isSafeInteger(length)||length>64*1024*1024){await response.body.cancel();throw Error('This browser needs its file-save API for report files over 64 MiB. Use the original authenticated API download or a browser with that API.');}
 const blob=await response.blob(),url=URL.createObjectURL(blob),anchor=node('a');anchor.href=url;anchor.download=suggested;
 document.body.append(anchor);anchor.click();anchor.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);message('Complete report file downloaded.');
}
async function loadHistory(before=r.historyBefore){
 const page=await api('/api/report-runs'+(before?'?before='+before:''));
 r.history=page;r.historyBefore=before;const body=$('report-history');body.replaceChildren();
 for(const item of page.reports){const row=node('tr');cell(row,stamp(item.created_at));cell(row,item.name+' · revision '+item.revision);
 cell(row,item.status+(item.error?' · '+item.error:''));cell(row,item.total_rows??'—');
 cell(row,'').append(button(item.status==='COMPLETE'?'Open report':'Open action',()=>item.status==='COMPLETE'?openReport(item.id):openJob(item.id)));body.append(row);}
 if(!page.reports.length)empty(body,5,'No retained report runs.');
}
async function loadPublications(before=r.publicationsBefore){
 const page=await api('/api/report-publications'+(before?'?before='+before:''));
 r.publications=page;r.publicationsBefore=before;const body=$('report-publications');body.replaceChildren();
 for(const item of page.publications){const pub=item.publication,row=node('tr');cell(row,stamp(pub.published_at));cell(row,pub.title+' · '+pub.name);
 cell(row,pub.revision);cell(row,pub.note.length>180?pub.note.slice(0,180)+'…':pub.note);
 cell(row,'').append(button('Open edition',()=>openReport(pub.job_id,pub.id)));body.append(row);}
 if(!page.publications.length)empty(body,5,'No published report editions.');
}
async function refreshReports(){
 if(!s.data)return;
 renderSaved();await loadHistory();await loadPublications();
 if(!r.draftLoaded){r.draftLoaded=true;let draft;try{draft=JSON.parse(localStorage.getItem(draftKey()));}catch{}
  if(draft?.editor&&Array.isArray(draft.editor.sections)){r.views=draft.views;setEditor(draft.editor,draft.loaded);r.base=draft.base;r.savePending=draft.savePending;saveDraft();}
  else{r.views=copy(s.data.views);setEditor({name:'',title:'',introduction:'',sections:[]});}
  let pending;try{pending=JSON.parse(localStorage.getItem('sf-analysis-report-publication:'+s.data.workspace_id));}catch{}
  if(pending?.jobId){await openReport(pending.jobId);r.publishPending={jobId:pending.jobId,key:pending.key,request:pending.request};$('report-publication-note').value=pending.request.note;message('Reopened the retained publication request. Publish again to recover its exact original result.');}
 }
 editorLabel();controls();
}
function reportControls(){
 const unavailable=s.busy||!s.data;
 for(const element of document.querySelectorAll('#tab-reports button,#tab-reports input,#tab-reports textarea,#tab-reports select'))element.disabled=unavailable;
 for(const element of document.querySelectorAll('[data-report-move]')){const index=Number(element.dataset.index);element.disabled||=element.dataset.reportMove==='up'?index===0:index===r.editor.sections.length-1;}
 $('report-add-section').disabled||=!s.data?.queries.length||r.editor.sections.length>=12;
 $('report-save').disabled||=!r.editor.sections.length;
 $('report-run').disabled||=!!s.active||!r.loaded||!sameName()||dirty()||r.views===null||JSON.stringify(r.views)!==JSON.stringify(s.data?.views);
 $('report-publish').disabled||=!!s.active||!r.result;
 for(const name of ['report-result-section','report-result-prev','report-result-next','report-result-refresh'])$(name).disabled||=!r.result;
 $('report-result-prev').disabled||=!r.result?.offset;$('report-result-next').disabled||=r.result?.next_offset==null;
 for(const name of ['report-export-html','report-export-json','report-export-csv'])$(name).disabled||=!!s.active||!r.publication;
 $('report-download').disabled||=!r.download;$('report-history-prev').disabled||=!r.historyPages.length;
 $('report-history-next').disabled||=!r.history?.next_before;$('report-publications-prev').disabled||=!r.publicationsPages.length;
 $('report-publications-next').disabled||=!r.publications?.next_before;
}
for(const name of ['report-name','report-title','report-introduction'])$(name).addEventListener('input',()=>{saveDraft();controls();});
$('report-publication-note').addEventListener('input',storeNote);
$('report-new').addEventListener('click',()=>act(()=>{if(!canReplaceEditor())return;r.views=copy(s.data.views);r.savePending=null;setEditor({name:'',title:'',introduction:'',sections:[]});}));
$('report-saved').addEventListener('change',()=>act(()=>loadDefinition($('report-saved').value)));
$('report-revision').addEventListener('change',()=>act(()=>loadDefinition(r.loaded?.definition.name,Number($('report-revision').value))));
$('report-add-section').addEventListener('click',()=>act(addSection));$('report-save').addEventListener('click',()=>act(saveDefinition));
$('report-review-views').addEventListener('click',()=>act(reviewViews));$('report-run').addEventListener('click',()=>act(runReport));
$('report-result-refresh').addEventListener('click',()=>act(()=>openReport(r.result.report.job_id,r.publication?.publication.id)));
$('report-result-section').addEventListener('change',()=>act(()=>resultPage(Number($('report-result-section').value),0)));
$('report-result-prev').addEventListener('click',()=>act(()=>resultPage(r.result.section.ordinal,Math.max(0,r.result.offset-100))));
$('report-result-next').addEventListener('click',()=>act(()=>resultPage(r.result.section.ordinal,r.result.next_offset)));
$('report-publish').addEventListener('click',()=>act(publishReport));
$('report-export-publication').addEventListener('change',()=>{r.publication=r.result.publications.find(item=>item.publication.id===$('report-export-publication').value)||null;renderPublication();controls();});
for(const format of ['html','json','csv'])$('report-export-'+format).addEventListener('click',()=>act(()=>exportReport(format)));
$('report-download').addEventListener('click',()=>act(downloadReport));
$('report-history-next').addEventListener('click',()=>act(async()=>{const before=r.history?.next_before;if(!before)return;const previous=r.historyBefore;await loadHistory(before);r.historyPages.push(previous);}));
$('report-history-prev').addEventListener('click',()=>act(async()=>{if(!r.historyPages.length)return;const before=r.historyPages.at(-1);await loadHistory(before);r.historyPages.pop();}));
$('report-publications-next').addEventListener('click',()=>act(async()=>{const before=r.publications?.next_before;if(!before)return;const previous=r.publicationsBefore;await loadPublications(before);r.publicationsPages.push(previous);}));
$('report-publications-prev').addEventListener('click',()=>act(async()=>{if(!r.publicationsPages.length)return;const before=r.publicationsPages.at(-1);await loadPublications(before);r.publicationsPages.pop();}));
window.customerReports={refresh:refreshReports,controls:reportControls,open:openReport,exportReady,dirty};
reportControls();
})();
'''
