"""World Bank named programmes in the original private Analysis console."""

HTML = r'''
<section id="tab-worldbank" hidden>
<section class="panel"><div class="section-head"><div><h2>World Bank customer programmes</h2><p>Review an approved source edition and refresh the same customer report and workbook. Saved SQL, worksheet choices and earlier deliveries remain available.</p></div><div class="toolbar"><button id="wb-intake">Receive approved handover</button><button id="wb-new">New programme</button></div></div>
<div class="table-scroll"><table><thead><tr><th>Programme</th><th>Revision</th><th>Customer view</th><th>Report / workbook</th><th></th></tr></thead><tbody id="wb-programmes"></tbody></table></div><div class="toolbar"><button id="wb-programmes-prev">Previous programmes</button><button id="wb-programmes-next">More programmes</button></div></section>
<section class="panel"><h2 id="wb-definition-heading">Programme definition</h2><p id="wb-definition-state" class="muted"></p>
<div class="grid"><label>Programme name<input id="wb-name" maxlength="64" pattern="[A-Za-z][A-Za-z0-9_-]{0,63}" autocomplete="off"></label><label>Title<input id="wb-title" maxlength="200"></label></div>
<div class="grid"><label>Customer view<select id="wb-view"></select></label><label>Saved report<select id="wb-report"></select></label></div>
<div class="grid"><label>Saved workbook<select id="wb-workbook"></select></label><label>Source name prefix<input id="wb-prefix" maxlength="21" value="worldbank"></label></div>
<label>Comparison keys, one per line<textarea id="wb-keys" rows="5" spellcheck="false">source_id
country_id
country_iso3
indicator_id
period</textarea></label><p class="hint">Use 1–16 distinct columns that identify every source observation. The complete original comparison rejects missing or duplicate keys.</p>
<button id="wb-save">Save programme definition</button></section>
<section id="wb-prepare-panel" class="panel" hidden><h2>Review the next source edition</h2><div id="wb-selected-definition" class="facts"></div>
<label>Registered World Bank source<select id="wb-source"></select></label><div class="toolbar"><button id="wb-sources-prev">Newer sources</button><button id="wb-sources-next">Older sources</button></div><div id="wb-source-details" class="facts"></div>
<p class="hint">Only original World Bank handovers already retained in this Analysis workspace are listed. Use Receive approved handover to register the original complete ZIP, then select its exact source revision here.</p>
<button id="wb-prepare" class="primary">Prepare source review</button></section>
<section id="wb-pending-panel" class="panel" hidden><h2>Unacknowledged local actions</h2><p>These exact requests were retained before sending. Read their current operation or continue the same request; reloading does not allocate another operation.</p><div id="wb-pending"></div></section>
<section class="panel"><h2>Programme operations</h2><p id="wb-history-context" class="muted">Recent operations across all programmes.</p><div class="table-scroll"><table><thead><tr><th>Programme</th><th>Operation</th><th>Status</th><th>Phase</th><th></th></tr></thead><tbody id="wb-operations"></tbody></table></div><div class="toolbar"><button id="wb-history-prev">Newer operations</button><button id="wb-history-next">Older operations</button></div></section>
<section id="wb-operation-panel" class="panel" hidden><div class="section-head"><div><h2>Selected programme operation</h2><p id="wb-operation-state"></p></div><button id="wb-operation-refresh">Read current operation</button></div><div id="wb-operation-facts" class="facts"></div><p id="wb-operation-error" class="notice" hidden></p>
<div id="wb-review-panel" hidden><h3>Retained source comparison</h3><div id="wb-review-facts" class="facts"></div><div id="wb-counts" class="comparison-counts"></div><section id="wb-metadata-panel" hidden><h3>Provider metadata records</h3><div id="wb-metadata-facts" class="facts"></div><p class="hint">These counts compare retained metadata record identities and their complete duplicate groups. Observation changes remain in the source comparison above.</p><details><summary>Complete provider metadata, selection and review changes</summary><pre id="wb-metadata-json"></pre></details></section><div class="toolbar"><button id="wb-open-comparison">Open complete comparison</button><button id="wb-review-download">Download review JSON</button></div>
<details><summary>Selected source, customer definitions and original identities</summary><pre id="wb-review-json"></pre></details></div>
<div id="wb-column-panel" hidden><h3>Review workbook columns</h3><p>Choose the exact source column and its position. Review every heading, type, null treatment and precision choice. Other worksheets retain their original saved sources.</p><div id="wb-unresolved" class="facts"></div><div id="wb-sheets"></div></div>
<div id="wb-publish-panel" hidden><h3>Refresh this customer edition</h3><label>Source-selection and workbook note<textarea id="wb-note" rows="3" maxlength="8000"></textarea></label><button id="wb-publish" class="primary">Refresh reviewed report and workbook</button></div>
<div id="wb-delivery-panel" hidden><h3>Customer delivery</h3><div id="wb-accepted-edition"></div><p id="wb-restored-note" class="hint"></p><button id="wb-reopen" hidden>Create portable delivery from this accepted edition</button><div id="wb-delivery" class="table-scroll"></div></div>
<div class="toolbar"><button id="wb-continue" hidden>Continue original operation</button></div>
<details><summary>Complete operation record</summary><pre id="wb-operation-json"></pre></details></section>
</section>
'''

CSS = r'''
#tab-worldbank input,#tab-worldbank select{max-width:100%}#tab-worldbank .wb-column{display:grid;grid-template-columns:2fr 2fr 1fr 1fr;gap:10px;border:1px solid #ccc;padding:12px;margin:10px 0}#tab-worldbank .wb-column .wb-wide{grid-column:span 2}#wb-keys{max-width:650px}#wb-pending .wb-pending-item{border-bottom:1px solid #ccc;padding:12px 0}#wb-operations td{overflow-wrap:anywhere}#wb-note{max-width:900px}#wb-sheets fieldset{min-width:0}#wb-delivery td{overflow-wrap:anywhere}#wb-review-json,#wb-operation-json{max-height:500px}@media(max-width:760px){#tab-worldbank .wb-column{grid-template-columns:1fr}#tab-worldbank .wb-column .wb-wide{grid-column:auto}#wb-operations td{max-width:170px}}
'''

JS = r'''
(() => {
 const w={page:null,before:null,pages:[],sources:[],sourceBefore:null,sourcePages:[],sourceNext:null,definition:null,base:'',history:null,historyBefore:null,historyPages:[],operation:null,selected:null,sequence:0,poll:null,pending:[],pendingLoaded:false,columns:null,columnOperation:null};
 const path=name=>'/api/worldbank-programmes/'+encodeURIComponent(name);
 const operationPath=(name,operation)=>path(name)+'/operations/'+encodeURIComponent(operation);
 const clone=value=>JSON.parse(JSON.stringify(value));
 const json=value=>JSON.stringify(value,null,2);
 const value=()=>({title:$('wb-title').value,view:$('wb-view').value,report:$('wb-report').value,workbook:$('wb-workbook').value,keys:$('wb-keys').value.split(/\r?\n/).map(x=>x.trim()).filter(Boolean),prefix:$('wb-prefix').value});
 const editor=()=>JSON.stringify({name:$('wb-name').value,definition:value()});
 const dirty=()=>editor()!==w.base;
 const pendingKey=()=> 'sf-worldbank-pending:'+s.data.workspace_id;
 function replacePending(rows){localStorage.setItem(pendingKey(),JSON.stringify(rows));w.pending=rows;renderPending();}
 const canonical=value=>Array.isArray(value)?value.map(canonical):value!==null&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
 const requestBody=value=>Object.fromEntries(Object.entries(value).filter(([key])=>key!=='resume'));
 function reconcilePending(name,op){
  const remaining=w.pending.filter(row=>{if(row.name!==name||row.operation!==op.operation_id||!['prepare','publish','reopen'].includes(row.kind))return true;const accepted=op[row.kind+'_request'];return !accepted||JSON.stringify(canonical(requestBody(row.body)))!==JSON.stringify(canonical(requestBody(accepted)));});
  if(remaining.length!==w.pending.length)replacePending(remaining);
 }
 function loadPending(){
  if(w.pendingLoaded||!s.data)return;
  const raw=localStorage.getItem(pendingKey());
  if(raw){const saved=JSON.parse(raw);if(!Array.isArray(saved)||saved.some(r=>!r||typeof r.path!=='string'||!r.path.startsWith('/api/worldbank-programmes/')||!r.body||typeof r.body.id!=='string'))throw Error('The retained World Bank action reminder is invalid. Preserve it before repairing local browser storage.');w.pending=saved;}
  w.pendingLoaded=true;renderPending();
 }
 function selectOptions(element,rows,selected){
  const old=selected===undefined?element.value:selected;element.replaceChildren();
  const blank=node('option','Choose an existing saved item');blank.value='';element.append(blank);
  for(const row of rows){const item=node('option',row.name+' · revision '+row.revision+(row.title?' · '+row.title:''));item.value=row.name;element.append(item);}
  if(old&&!rows.some(r=>r.name===old)){const item=node('option',old+' · retained selection');item.value=old;element.append(item);}
  element.value=old||'';
 }
 function selectors(){
  selectOptions($('wb-view'),s.data?.views||[]);
  selectOptions($('wb-report'),s.data?.reports||[]);
  selectOptions($('wb-workbook'),s.data?.workbooks||[]);
 }
 function setDefinition(record){
  w.definition=record;$('wb-name').value=record?.name||'';$('wb-name').readOnly=!!record;
  const d=record?.definition||{title:'',view:'',report:'',workbook:'',keys:['source_id','country_id','country_iso3','indicator_id','period'],prefix:'worldbank'};
  $('wb-title').value=d.title;$('wb-prefix').value=d.prefix;$('wb-keys').value=d.keys.join('\n');selectors();
  for(const key of ['view','report','workbook'])selectOptions($('wb-'+key),s.data?.[key==='view'?'views':key==='report'?'reports':'workbooks']||[],d[key]);
  w.base=editor();$('wb-definition-state').textContent=record?'Loaded programme revision '+record.revision+'. Save compares with this exact revision.':'Create a programme from the customer’s existing saved view, report and workbook.';
  $('wb-prepare-panel').hidden=!record;const box=$('wb-selected-definition');box.replaceChildren();
  if(record){fact(box,'Programme',record.name);fact(box,'Definition revision',record.revision);fact(box,'Definition SHA-256',record.definition_sha256);fact(box,'Customer view',d.view);fact(box,'Saved report',d.report);fact(box,'Saved workbook',d.workbook);}
  controls();
 }
 async function openDefinition(name){
  if(dirty()&&!confirm('Discard unsaved programme definition changes?'))return;
  const record=await api(path(name));setDefinition(record);w.historyBefore=null;w.historyPages=[];await historyPage();tab('worldbank');
 }
 function renderProgrammes(){
  const body=$('wb-programmes');body.replaceChildren();
  for(const row of w.page?.programmes||[]){const tr=node('tr');cell(tr,row.definition.title+' · '+row.name);cell(tr,row.revision);cell(tr,row.definition.view);cell(tr,row.definition.report+' / '+row.definition.workbook);cell(tr).append(button('Open',()=>openDefinition(row.name)));body.append(tr);}
  if(!w.page?.programmes?.length)empty(body,5,'No saved World Bank programme on this page.');
 }
 async function programmePage(before=null,pages=[]){
  const data=await api('/api/worldbank-programmes'+(before?'?before='+encodeURIComponent(before):''));w.page=data;w.before=before;w.pages=pages;renderProgrammes();
  if(!w.definition){w.history={operations:data.operations||[],next_before:null};renderHistory();}
 }
 function sourceKey(row){return row.name+'\n'+row.revision;}
 function renderSources(){
  const select=$('wb-source'),old=select.value;select.replaceChildren();
  const blank=node('option','Choose a retained complete World Bank handover');blank.value='';select.append(blank);
  for(const row of w.sources){const o=node('option',row.title+' · '+row.name+' revision '+row.revision);o.value=sourceKey(row);select.append(o);}
  if(w.sources.some(row=>sourceKey(row)===old))select.value=old;sourceDetails();controls();
 }
 function sourceDetails(){
  const row=w.sources.find(r=>sourceKey(r)===$('wb-source').value),box=$('wb-source-details');box.replaceChildren();
  if(row){fact(box,'Source',row.name);fact(box,'Revision',row.revision);fact(box,'Original document',row.document_id);fact(box,'Handover bytes',row.handover.bytes);fact(box,'Handover SHA-256',row.handover.sha256);fact(box,'Captured',row.source_metadata?.capturedAt);fact(box,'Included observations',row.review?.includedObservations);}
 }
 async function sourcePage(before=null,pages=[]){
  const result=await api('/api/worldbank-programmes/sources'+(before?'?before='+before:''));w.sources=result.sources;w.sourceNext=result.next_before;w.sourceBefore=before;w.sourcePages=pages;renderSources();
 }
 async function historyPage(before=null,pages=[]){
  if(!w.definition)return;
  const page=await api(path(w.definition.name)+'/history'+(before?'?before='+before:''));w.history=page;w.historyBefore=before;w.historyPages=pages;renderHistory();controls();
 }
 function renderHistory(){
  $('wb-history-context').textContent=w.definition?'All retained operations for '+w.definition.name+' · page '+(w.historyPages.length+1):'Most recent 50 operations across all programmes. Open a programme for its complete paginated history.';
  const body=$('wb-operations');body.replaceChildren();
  for(const row of w.history?.operations||[]){const tr=node('tr');cell(tr,row.name);cell(tr,row.operation_id,'code');cell(tr,row.status);cell(tr,row.phase);cell(tr).append(button('Open',()=>openOperation(row.name,row.operation_id)));body.append(tr);}
  if(!w.history?.operations?.length)empty(body,5,'No retained operation on this page.');
 }
 function renderPending(){
  $('wb-pending-panel').hidden=!w.pending.length;const box=$('wb-pending');box.replaceChildren();
  for(const row of w.pending){const item=node('div',undefined,'wb-pending-item');item.append(node('p',row.label+' · '+row.body.id),button('Continue exact request',()=>postRetained(row)));
   if(row.operation)item.append(button('Read operation',()=>openOperation(row.name,row.operation)));
   const details=node('details');details.append(node('summary','Retained request'),node('pre',json({path:row.path,body:row.body})));item.append(details);box.append(item);
  }
 }
 async function postRetained(row){
  const retained=w.pending.find(r=>r.body.id===row.body.id&&r.path===row.path);
  if(retained&&JSON.stringify(retained.body)!==JSON.stringify(row.body))throw Error('An earlier request for this operation is still awaiting acknowledgment. Continue its exact retained request before changing these choices.');
  if(!retained)replacePending([...w.pending,clone(row)]);
  const result=await api(row.path,row.body);
  replacePending(w.pending.filter(r=>!(r.body.id===row.body.id&&r.path===row.path)));
  await programmePage(w.before,w.pages);
  if(row.kind==='save'){setDefinition(result);await historyPage();message('Programme definition saved at revision '+result.revision+'.');}
  else{await openOperation(row.name,row.operation);message('Original World Bank operation '+row.operation+' is retained.');}
  return result;
 }
 async function submit(kind,name,url,body,label){
  const row={kind,name,path:url,body:clone(body),label,operation:kind==='save'?null:body.id};return postRetained(row);
 }
 function schedule(){
  clearTimeout(w.poll);
  if(w.operation?.status==='RUNNING')w.poll=setTimeout(async()=>{if(s.busy){schedule();return;}try{await refreshOperation();}catch(error){message(error.message,true);}finally{schedule();}},2000);
 }
 async function openOperation(name,operation){
  const selection={name,operation};w.selected=selection;const seq=++w.sequence;
  const result=await api(operationPath(name,operation));
  if(seq!==w.sequence)return;reconcilePending(name,result);w.operation=result;renderOperation();schedule();tab('worldbank');
 }
 async function refreshOperation(){
  if(!w.selected)return;const chosen={...w.selected},seq=++w.sequence;
  const result=await api(operationPath(chosen.name,chosen.operation));
  if(seq!==w.sequence||w.selected?.operation!==chosen.operation)return;
  reconcilePending(chosen.name,result);w.operation=result;renderOperation();await historyPage(w.historyBefore,w.historyPages);controls();
 }
 function labelled(label,input,cls){const n=node('label',label,cls);n.append(input);return n;}
 function optionSelect(values,current,change){
  const n=node('select');for(const [key,label] of values){const o=node('option',label);o.value=key;n.append(o);}n.value=String(current);n.addEventListener('change',()=>change(n.value));return n;
 }
 function inputText(current,change){const n=node('input');n.value=current??'';n.addEventListener('input',()=>change(n.value));return n;}
 function renderColumns(){
  const op=w.operation,proposal=op?.proposal,review=op?.review;
  $('wb-column-panel').hidden=op?.status!=='WORKBOOK_COLUMN_CHOICES_REQUIRED'||!proposal;
  if($('wb-column-panel').hidden)return;
  if(w.columnOperation!==op.operation_id){w.columns={};for(const index of review.related_sheets)w.columns[String(index)]=clone(proposal.definition.sheets[index].columns);w.columnOperation=op.operation_id;}
  const unresolved=$('wb-unresolved');unresolved.replaceChildren();
  for(const item of proposal.unresolved_columns||[])fact(unresolved,'Worksheet '+(item.sheet+1),json(item));
  const box=$('wb-sheets');box.replaceChildren();
  for(const index of review.related_sheets){
   const sheet=proposal.definition.sheets[index],columns=w.columns[String(index)],field=node('fieldset');field.append(node('legend',sheet.name));
   columns.forEach((column,columnIndex)=>{
    const row=node('div',undefined,'wb-column'),source=sheet.source;
    const current=column.source_index??source.columns.indexOf(column.source);
    row.append(labelled('Original source column',optionSelect(source.columns.map((name,i)=>[String(i),(i+1)+': '+name]),current,value=>{const chosen=Number(value);column.source=source.columns[chosen];if(source.kind==='report')column.source_index=chosen;else delete column.source_index;}),'wb-wide'));
    row.append(labelled('Worksheet heading',inputText(column.header,v=>column.header=v),'wb-wide'));
    row.append(labelled('Cell type',optionSelect(['native','text','integer','number','decimal-text','boolean','date','datetime-utc','datetime-local','binary-base64'].map(v=>[v,v]),column.type,v=>column.type=v)));
    row.append(labelled('Null cells',optionSelect([['blank','Blank cell'],['text','Explicit text']],column.null,v=>column.null=v)));
    row.append(labelled('Null text',inputText(column.null_text,v=>column.null_text=v)));
    row.append(labelled('Numeric precision',optionSelect([['preserve','Preserve exact value'],['excel-number','Excel number']],column.precision||'preserve',v=>column.precision=v)));
    row.append(button('Remove column',async()=>{if(columns.length===1)throw Error('Keep at least one worksheet column.');columns.splice(columnIndex,1);renderColumns();}));
    field.append(row);
   });
   field.append(button('Add column',async()=>{const source=sheet.source;if(!source.columns.length)throw Error('The retained source has no columns.');columns.push({source:source.columns[0],...(source.kind==='report'?{source_index:0}:{}),header:source.columns[0],type:'text',null:'blank',null_text:'',precision:'preserve'});renderColumns();}));
   box.append(field);
  }
 }
 function renderDelivery(){
  const op=w.operation,result=op?.result,panel=$('wb-delivery-panel');panel.hidden=op?.status!=='COMPLETE'&&!op?.can_reopen;if(panel.hidden)return;
  const box=$('wb-delivery');box.replaceChildren();const accepted=$('wb-accepted-edition');accepted.replaceChildren();
  if(op.accepted_edition){const details=node('details');details.append(node('summary','Accepted source, report publication and workbook identities'),node('pre',json(op.accepted_edition)));accepted.append(details);}
  const table=node('table'),head=node('thead'),tr=node('tr');for(const label of ['File','Bytes','SHA-256',''])tr.append(node('th',label));head.append(tr);table.append(head);const body=node('tbody');
  const downloads=op.downloads||[],unavailable=downloads.some(f=>f.available===false);$('wb-reopen').hidden=!op.can_reopen;
  $('wb-restored-note').textContent=op.can_reopen?(op.status!=='COMPLETE'?'The original delivery assembly is incomplete, while its source selection, report publication and workbook are accepted. Create a new portable delivery from those verified results; the original interrupted operation stays retained.':unavailable?'This received workspace retains the accepted publication and workbook. Create a new portable delivery to package those same results with this workspace; no source selection or business result is rerun.':'Create another portable delivery from the accepted source, publication and workbook when needed. Its new delivery ID preserves the original operation.'):'';
  for(const f of result?.files||[]){const r=node('tr');cell(r,f.filename);cell(r,f.bytes);cell(r,f.sha256,'code');const retained=downloads.find(d=>d.filename===f.filename);if(op.status!=='COMPLETE'||retained?.available===false)cell(r,'Unavailable in this delivery');else cell(r).append(button('Download',()=>downloadDelivery(f)));body.append(r);}
  if(!result?.files?.length)empty(body,4,'No completed outer delivery files are retained for this operation.');
  table.append(body);box.append(table);
 }
 async function downloadDelivery(record){
  const url=operationPath(w.selected.name,w.selected.operation)+'/files/'+encodeURIComponent(record.filename);
  let target=null;
  if(record.bytes>64*1024*1024){if(!window.showSaveFilePicker)throw Error('Use a browser with direct file saving for this complete large delivery, or use its retained file through the command line.');try{target=await window.showSaveFilePicker({suggestedName:record.filename});}catch(error){if(error.name==='AbortError')return;throw error;}}
  const response=await fetch(url,{headers:{'X-Analysis-Capability':capability},cache:'no-store'});
  if(!response.ok){throw Error((await response.json()).error||'Delivery download failed.');}
  if(Number(response.headers.get('Content-Length'))!==record.bytes||response.headers.get('X-Content-SHA256')!==record.sha256){await response.body.cancel();throw Error('The retained delivery descriptor changed.');}
  if(target){const stream=await target.createWritable();try{await response.body.pipeTo(stream);}catch(error){await stream.abort().catch(()=>{});throw error;}}
  else{const blob=await response.blob();if(blob.size!==record.bytes)throw Error('The complete delivery download was interrupted.');const link=node('a');link.href=URL.createObjectURL(blob);link.download=record.filename;document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(link.href),1000);}
  message('Saved '+record.filename+' · '+record.bytes+' bytes · SHA-256 '+record.sha256);
 }
 function renderOperation(){
  const op=w.operation;if(!op)return;$('wb-operation-panel').hidden=false;$('wb-operation-state').textContent=op.status+' · '+(op.phase||'')+' · '+op.operation_id;
  const facts=$('wb-operation-facts');facts.replaceChildren();fact(facts,'Programme',w.selected.name);fact(facts,'Original operation',op.operation_id);
  $('wb-operation-error').hidden=!op.error;$('wb-operation-error').textContent=typeof op.error==='string'?op.error:json(op.error||'');
  const review=op.review;$('wb-review-panel').hidden=!review;
  if(review){const box=$('wb-review-facts');box.replaceChildren();fact(box,'Review SHA-256',review.review_sha256);fact(box,'Baseline view',review.baseline_view.name+' · revision '+review.baseline_view.revision);fact(box,'Candidate version',review.candidate_version_id);fact(box,'Saved report',review.target.report+' · revision '+review.report.definition.revision);fact(box,'Saved workbook',review.target.workbook+' · revision '+review.workbook.definition.revision);
   const counts=$('wb-counts');counts.replaceChildren();for(const [label,total]of Object.entries(review.comparison.counts||{})){const box=node('div');box.append(node('strong',String(total)),node('span',label));counts.append(box);}$('wb-review-json').textContent=json(review);
   const metadata=review.metadata_review;$('wb-metadata-panel').hidden=!metadata;
   if(metadata){const facts=$('wb-metadata-facts');facts.replaceChildren();fact(facts,'Same retained provider capture',metadata.same_capture?'Yes':'No');fact(facts,'Same selected source scope',metadata.same_selection?'Yes':'No');
    for(const [label,total]of Object.entries(metadata.provider_metadata_counts||{}))fact(facts,'Provider metadata records · '+label,total);
    fact(facts,'Source selection fields changed',Object.keys(metadata.selection_changes||{}).join(', ')||'None');fact(facts,'Review fields changed',Object.keys(metadata.review_changes||{}).join(', ')||'None');$('wb-metadata-json').textContent=json(metadata);}

  }
  const publishing=['REVIEW_READY','WORKBOOK_COLUMN_CHOICES_REQUIRED'].includes(op.status);$('wb-publish-panel').hidden=!publishing;
  if(w.noteOperation!==op.operation_id){$('wb-note').value=op.publish_request?.note||'';w.noteOperation=op.operation_id;}
  $('wb-note').readOnly=!!op.publish_request;
  $('wb-continue').hidden=!['ERROR','INTERRUPTED'].includes(op.status);
  $('wb-operation-json').textContent=json(op);renderColumns();renderDelivery();controls();
 }
 function controls(){
  const disabled=s.busy||!s.data;
  for(const n of $('tab-worldbank').querySelectorAll('button,input,select,textarea'))n.disabled=disabled;
  $('wb-programmes-prev').disabled||=!w.pages.length;$('wb-programmes-next').disabled||=!w.page?.next_before;
  $('wb-sources-prev').disabled||=!w.sourcePages.length;$('wb-sources-next').disabled||=!w.sourceNext;
  $('wb-history-prev').disabled||=!w.historyPages.length;$('wb-history-next').disabled||=!w.definition||!w.history?.next_before;
  $('wb-prepare').disabled||=!w.definition||dirty()||!$('wb-source').value;
  $('wb-save').disabled||=!dirty();
  $('wb-publish').disabled||=!$('wb-note').value.trim()||!w.operation?.review;
 }
 async function receiveIntakeSelection(){
  const key='worldbank-intake-selection:'+s.data.workspace_id,raw=sessionStorage.getItem(key);
  if(!raw)return;
  const selected=JSON.parse(raw);
  if(!selected||typeof selected.name!=='string'||!Number.isInteger(selected.revision))throw Error('The retained source selection is invalid.');
  let cursor=null,pages=[];
  for(;;){
   await sourcePage(cursor,pages);
   const found=w.sources.find(row=>row.name===selected.name&&row.revision===selected.revision);
   if(found){$('wb-source').value=sourceKey(found);sourceDetails();sessionStorage.removeItem(key);tab('worldbank');message('Approved source registered. Choose the customer programme and prepare its source review.');break;}
   if(w.sourceNext===null)throw Error('The registered source revision is not in this workspace. Open its original intake history.');
   pages=[...pages,cursor];cursor=w.sourceNext;
  }
 }
 $('wb-intake').addEventListener('click',()=>act(async()=>{
  if(dirty()&&!confirm('Leave the unsaved programme definition to receive a handover?'))return;
  location.href='/worldbank-intake#'+capability;
 }));
 async function refreshWorldBank(){
  if(!s.data)return;selectors();loadPending();
  await programmePage(w.before,w.pages);await sourcePage(w.sourceBefore,w.sourcePages);
  if(w.definition)await historyPage(w.historyBefore,w.historyPages);
  if(!w.base)setDefinition(null);await receiveIntakeSelection();controls();
 }
 $('wb-new').addEventListener('click',()=>act(async()=>{if(dirty()&&!confirm('Discard unsaved programme definition changes?'))return;setDefinition(null);w.history={operations:w.page?.operations||[],next_before:null};w.historyPages=[];renderHistory();}));
 $('wb-save').addEventListener('click',()=>act(async()=>{
  const name=$('wb-name').value.trim(),definition=value();if(name==='sources'||!/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(name)||!definition.title.trim()||!definition.view||!definition.report||!definition.workbook)throw Error('Select a name, title and the existing customer view, report and workbook.');
  await submit('save',name,path(name),{id:id(),expected_revision:w.definition?.revision||0,definition},'Save programme '+name);
 }));
 $('wb-prepare').addEventListener('click',()=>act(async()=>{
  const source=w.sources.find(r=>sourceKey(r)===$('wb-source').value);if(!source||!w.definition||dirty())throw Error('Save the selected programme definition and choose an original retained source.');
  const name=w.definition.name;await submit('prepare',name,path(name)+'/prepare',{id:id(),expected_revision:w.definition.revision,source:{name:source.name,revision:source.revision},resume:false},'Prepare source review for '+name);
 }));
 $('wb-publish').addEventListener('click',()=>act(async()=>{
  const op=w.operation,body={id:op.operation_id,review_sha256:op.review.review_sha256,note:$('wb-note').value,columns:op.status==='WORKBOOK_COLUMN_CHOICES_REQUIRED'?clone(w.columns):null,resume:!!op.publish_request};
  await submit('publish',w.selected.name,operationPath(w.selected.name,op.operation_id)+'/publish',body,'Refresh reviewed customer edition');
 }));
 $('wb-continue').addEventListener('click',()=>act(async()=>{
  const op=w.operation,original=op.reopen_request||op.publish_request||op.prepare_request;if(!original)throw Error('The original operation request is unavailable; preserve this operation and use its command-line continuation.');
  const kind=op.reopen_request?'reopen':op.publish_request?'publish':'prepare',url=kind==='publish'?operationPath(w.selected.name,op.operation_id)+'/publish':path(w.selected.name)+'/'+kind;
  await submit(kind,w.selected.name,url,{...clone(original),id:op.operation_id,resume:true},'Continue original '+kind);
 }));
 $('wb-reopen').addEventListener('click',()=>act(async()=>{const op=w.operation;await submit('reopen',w.selected.name,path(w.selected.name)+'/reopen',{id:id(),operation_id:op.operation_id,resume:false},'Create portable delivery from accepted edition');}));
 $('wb-operation-refresh').addEventListener('click',()=>act(refreshOperation));
 $('wb-open-comparison').addEventListener('click',()=>act(()=>openComparison(w.operation.review.comparison.id)));
 $('wb-review-download').addEventListener('click',()=>act(async()=>{const body=new Blob([json(w.operation.review)+'\n'],{type:'application/json'}),a=node('a');a.href=URL.createObjectURL(body);a.download='WorldBank_Recurring_Review.json';document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(a.href),1000);}));
 $('wb-source').addEventListener('change',()=>{sourceDetails();controls();});
 for(const n of ['wb-name','wb-title','wb-view','wb-report','wb-workbook','wb-prefix','wb-keys','wb-note'])$(n).addEventListener('input',controls);
 $('wb-programmes-next').addEventListener('click',()=>act(()=>programmePage(w.page.next_before,[...w.pages,w.before])));
 $('wb-programmes-prev').addEventListener('click',()=>act(()=>programmePage(w.pages.at(-1),w.pages.slice(0,-1))));
 $('wb-sources-next').addEventListener('click',()=>act(()=>sourcePage(w.sourceNext,[...w.sourcePages,w.sourceBefore])));
 $('wb-sources-prev').addEventListener('click',()=>act(()=>sourcePage(w.sourcePages.at(-1),w.sourcePages.slice(0,-1))));
 $('wb-history-next').addEventListener('click',()=>act(()=>historyPage(w.history.next_before,[...w.historyPages,w.historyBefore])));
 $('wb-history-prev').addEventListener('click',()=>act(()=>historyPage(w.historyPages.at(-1),w.historyPages.slice(0,-1))));
 window.worldbankProgrammes={refresh:refreshWorldBank,controls,dirty};
})();
'''
