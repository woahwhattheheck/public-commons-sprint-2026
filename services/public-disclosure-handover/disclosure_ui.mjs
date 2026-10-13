export function mountDisclosure({root,model,initial=null,template}) {
 const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const now=()=>new Date().toISOString(),clone=x=>JSON.parse(JSON.stringify(x));
 let workspace=initial?.workspace?model.reopen(JSON.stringify(initial.workspace)):model.create({createdAt:now()});
 let draft=initial?.draft||{format:'csv',url:'https://eiti-database.eiti.org/eiti_database/view_payments_detailed.csv?_size=max&country_name=Guinea',retrievedAt:now(),representation:'operator-supplied-file',scope:'',population:'company-payments',expectedRows:'',completenessNote:'',mapping:{...model.eitiMapping},content:'',filename:''};
 let focusReview=false;
 let reviewDraft=initial?.reviewDraft||{snapshotId:null,target:null,status:'open',owner:'',note:''};
 let profile=workspace.selected?model.profile(workspace):null,headers=[],error='',notice='',busy=false,generation=0,page=0,query='',issueOnly=false,selected=null;
 const perPage=50,MAX=128*1024*1024;
 function bytes(s){return new TextEncoder().encode(s).length;}
 function bounded(s){if(bytes(s)>MAX)throw Error('The complete working copy exceeds 128 MiB. Keep the current page open and download its individual original sources before starting a smaller selection.');return s;}
 function download(name,content,type='application/json'){const blob=new Blob([content],{type}),url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),60000);}
 function checkDraft(value){
  if(!value||typeof value!=='object'||Array.isArray(value)||!value.mapping||typeof value.mapping!=='object'||Array.isArray(value.mapping))throw Error('Open a complete saved import draft.');
  for(const key of ['format','url','retrievedAt','representation','scope','population','expectedRows','completenessNote','content','filename'])if(typeof value[key]!=='string')throw Error('Retained draft '+key+' must remain text.');
  for(const role of model.roles)if(value.mapping[role]!==null&&typeof value.mapping[role]!=='string')throw Error('Retained mapping '+role+' is invalid.');
  if(!['csv','datasette-json'].includes(value.format)||!['company-payments','government-revenues'].includes(value.population)||!['operator-supplied-file','http-response-text','retrieved-web-representation'].includes(value.representation))throw Error('Retained draft source options are invalid.');
  bounded(JSON.stringify(value));return clone(value);
 }
 function capture(){
  const form=root.querySelector('[data-import]');if(!form)return;
  const data=new FormData(form);
  for(const key of ['format','url','retrievedAt','representation','scope','population','expectedRows','completenessNote'])if(data.has(key))draft[key]=String(data.get(key));
  for(const role of model.roles)if(data.has('map-'+role))draft.mapping[role]=String(data.get('map-'+role))||null;
  const reviewForm=root.querySelector('[data-review-form]');if(reviewForm){const reviewData=new FormData(reviewForm);for(const key of ['status','owner','note'])if(reviewData.has(key))reviewDraft[key]=String(reviewData.get(key));}
 }
 function snapshot(){capture();return {schema:'commons.public-disclosure-working-copy.v1',workspace:clone(workspace),draft:clone(draft),reviewDraft:clone(reviewDraft)};}
 function original(name,text){download(name,text,name.endsWith('.csv')?'text/csv;charset=utf-8':'application/json');}
 function activeRows(){if(!profile)return [];const q=query.toLowerCase(),bad=new Set(profile.issues.flatMap(i=>i.observationIds||[i.observationId]).filter(Boolean));return profile.observations.filter(r=>(!issueOnly||bad.has(r.id))&&(!q||r.cells.some(c=>String(c.raw??'').toLowerCase().includes(q))));}
 function role(r,name){const c=r.roles[name];return c===null?'Unmapped':c.kind==='null'?'null':c.kind==='empty'?'(empty)':c.raw;}
 function selectOption(values,current){return values.map(v=>'<option value="'+esc(v)+'"'+(v===current?' selected':'')+'>'+esc(v||'Unmapped')+'</option>').join('');}
 function refreshHeaders(){headers=[];if(!draft.content)return;try{headers=model.inspectSource(draft.format,draft.content).headers;}catch(e){error=e.message;}}
 function checkedReviewDraft(v){
  if(!v||typeof v!=='object'||Array.isArray(v)||!['status','owner','note'].every(k=>typeof v[k]==='string')||!(v.snapshotId===null||typeof v.snapshotId==='string'))throw Error('Retained review draft is invalid.');
  if(v.target!==null&&(!v.target||typeof v.target!=='object'||Array.isArray(v.target)||!['row','finding','repeated-key'].includes(v.target.kind)||typeof v.target.id!=='string'))throw Error('Retained review target is invalid.');
  bounded(JSON.stringify(v));return clone(v);
 }
 function startReview(target){
  capture();
  if(reviewDraft.target){
   const same=reviewDraft.snapshotId===profile.snapshotId&&JSON.stringify(reviewDraft.target)===JSON.stringify(target);
   if(same){focusReview=true;return;}
   if(reviewDraft.note||reviewDraft.owner||reviewDraft.status!=='open')throw Error('Save the current review decision or back up and clear its draft before opening another target.');
  }
  const prior=profile.reviews.find(r=>r.target.kind===target.kind&&r.target.id===target.id)?.history.at(-1);
  reviewDraft={snapshotId:profile.snapshotId,target:clone(target),status:prior?.status||'open',owner:prior?.owner||'',note:prior?.note||''};focusReview=true;
 }
 function reviewContext(p){
  const t=reviewDraft.target;if(!t)return '';
  const item=(t.kind==='row'?p.observations:t.kind==='finding'?p.issues:p.repeatedKeys).find(r=>r.id===t.id);
  if(!item)return '<p>This review target is absent. Return to its original source.</p>';
  const ids=new Set(t.kind==='row'?[item.id]:item.observationIds||[item.observationId].filter(Boolean));
  const rows=p.observations.filter(r=>ids.has(r.id));
  return '<p>'+esc(item.message||('Inspect '+rows.length+' original observations for this target.'))+'</p><div class="table-scroll"><table><tr><th>Original row</th><th>Company</th><th>Reported amount/currency</th><th>Inspect</th></tr>'+rows.slice(0,25).map(r=>'<tr><td>'+r.record+'</td><td>'+esc(role(r,'company'))+'</td><td>'+esc(role(r,'amount')+' '+role(r,'currency'))+'</td><td><button type="button" data-record="'+esc(r.id)+'">Inspect row</button></td></tr>').join('')+'</table></div>'+(rows.length>25?'<p>The first 25 original target rows are shown; the complete profile retains all '+rows.length+'.</p>':'');
 }
 function reviewSection(p){
  const selected=reviewDraft.target&&reviewDraft.snapshotId===p.snapshotId;
  return '<section><h2>Source review register</h2><p>Decisions describe review of the original source. Source values and totals remain unchanged. '+p.reviews.length+' reviewed targets in this snapshot.</p>'+
   '<div class="actions"><button data-action="reviews-json">Download review history JSON</button><button data-action="reviews-csv">Download review history CSV</button></div>'+
   (reviewDraft.target&&!selected?'<p>An unfinished review belongs to another retained snapshot. Select that snapshot to resume it; complete backups retain its text.</p>':'')+
   (selected?'<form data-review-form><p class="mono">'+esc(reviewDraft.target.kind+' · '+reviewDraft.target.id)+'</p>'+reviewContext(p)+'<div class="grid"><label>Status<select name="status">'+selectOption(['open','accepted','needs-source-check','resolved'],reviewDraft.status)+'</select></label><label>Review owner<input name="owner" value="'+esc(reviewDraft.owner)+'" maxlength="300" required></label><label class="wide">Explanation<textarea name="note" maxlength="8000" required>'+esc(reviewDraft.note)+'</textarea></label></div><div class="actions"><button type="submit">Save review decision</button><button type="button" data-action="clear-review">Clear review draft</button></div></form>':'<p>Choose Review row, Review finding or Review group beside its original source to begin.</p>')+
   p.reviews.map(r=>'<details><summary>'+esc(r.target.kind+' · '+r.history.at(-1).status+' · '+r.history.at(-1).owner)+'</summary><p class="mono">'+esc(r.target.id)+'</p><ol>'+r.history.map(e=>'<li><strong>'+esc('Revision '+e.revision+' · '+e.status+' · '+e.owner)+'</strong><p>'+esc(e.at)+'</p><pre>'+esc(e.note)+'</pre><p class="mono">'+esc(e.sha256)+'</p></li>').join('')+'</ol><button data-review-kind="'+esc(r.target.kind)+'" data-review-id="'+esc(r.target.id)+'">Review this target</button></details>').join('')+'</section>';
 }
 function render(){
  const rows=activeRows(),start=page*perPage;if(start>=rows.length&&page)page=Math.max(0,Math.ceil(rows.length/perPage)-1);
  const display=rows.slice(page*perPage,(page+1)*perPage),p=profile;
  root.innerHTML='<header><p class="eyebrow">Public source working desk</p><h1>Disclosure data handover</h1><p>Keep original payments, source mappings and review findings together. Select one retained snapshot at a time.</p></header>'+
  '<div role="alert" class="error">'+esc(error)+'</div><div role="status">'+esc(notice)+'</div>'+
  '<nav aria-label="Working copy"><button data-action="save">Save working copy</button><label class="file">Open working copy<input data-open type="file" accept=".json,application/json"></label><button data-action="editable">Save editable HTML</button><button data-action="print">Print management brief</button></nav>'+
  '<details'+(!p?' open':'')+'><summary>Receive an original source</summary><form data-import><div class="grid">'+
  '<label>Source format<select name="format">'+selectOption(['csv','datasette-json'],draft.format)+'</select></label>'+
  '<label>Original population<select name="population">'+selectOption(['company-payments','government-revenues'],draft.population)+'</select></label>'+
  '<label>Source file<input data-source type="file" accept=".csv,.json,text/csv,application/json"><span>'+esc(draft.filename||(draft.content?'Retained draft source':'Choose a complete original export'))+'</span></label>'+
  '<label>Source URL<input name="url" value="'+esc(draft.url)+'" required></label>'+
  '<label>Retrieval date or timestamp with timezone<input name="retrievedAt" value="'+esc(draft.retrievedAt)+'" required></label>'+
  '<label>Received representation<select name="representation">'+selectOption(['operator-supplied-file','http-response-text','retrieved-web-representation'],draft.representation)+'</select></label>'+
  '<label class="wide">Exact scope<input name="scope" value="'+esc(draft.scope)+'" placeholder="Country, year, company or complete page; preserve the actual filter" required></label>'+
  '<label>Declared expected rows<input name="expectedRows" value="'+esc(draft.expectedRows)+'" inputmode="numeric" placeholder="Leave blank when unknown"></label>'+
  '<label class="wide">Scope and retrieval note<textarea name="completenessNote">'+esc(draft.completenessNote)+'</textarea></label></div>'+
  '<h2>Map original columns</h2><p>Column spelling and whitespace stay exact. A CSV empty field remains empty; the source does not establish whether it originally meant null.</p><div class="mapping">'+model.roles.map(role=>'<label>'+esc(role)+'<select name="map-'+role+'">'+selectOption(['',...headers],draft.mapping[role]||'')+'</select></label>').join('')+'</div>'+
  '<button type="submit">Retain source and profile</button></form></details>'+
  '<section><h2>Retained snapshots</h2><label>Original source edition<select data-snapshot><option value="">Choose a retained source</option>'+workspace.snapshots.map(s=>'<option value="'+esc(s.id)+'"'+(s.id===workspace.selected?' selected':'')+'>'+esc(s.metadata.population+' · '+s.metadata.scope+' · '+s.identity.sha256.slice(0,12))+'</option>').join('')+'</select></label></section>'+
  (p?'<section><h2>Source and coverage</h2><dl><dt>Population</dt><dd>'+esc(p.metadata.population)+'</dd><dt>Exact scope</dt><dd>'+esc(p.coverage.scope)+'</dd><dt>Rows retained</dt><dd>'+p.counts.rows+'</dd><dt>Completeness</dt><dd>'+esc(p.coverage.complete?'Complete within the recorded scope':'Partial or unconfirmed scope')+' — '+esc(p.coverage.reason)+'</dd><dt>Next page</dt><dd>'+esc(p.coverage.next??'No cursor in this source')+'</dd><dt>Source SHA256</dt><dd class="mono">'+esc(p.sourceSha256)+'</dd><dt>Representation</dt><dd>'+esc(p.metadata.representation)+'</dd><dt>Retrieved</dt><dd>'+esc(p.metadata.retrievedAt)+'</dd><dt>Original update values</dt><dd>'+esc(p.updatedValues.join(' · ')||'No mapped update value')+'</dd></dl><details><summary>Original column mapping</summary><dl>'+model.roles.map(role=>'<dt>'+esc(role)+'</dt><dd>'+esc(p.mapping[role]??'Unmapped')+'</dd>').join('')+'</dl></details><div class="actions"><button data-action="original">Download original source</button><button data-action="profile">Download complete profile</button><button data-action="csv">Download spreadsheet-safe observations</button></div><p>Each total below belongs to this one snapshot, declaration, year, currency, payment kind and amount column. Company payments and government revenues are separate populations.</p></section>'+
  '<section><h2>Exact reported-value totals</h2><p>These sums preserve every original numeric value, including repeated keys. An in-kind amount is identified by its original flag; this view does not assign it a monetary interpretation.</p><div class="table-scroll"><table><thead><tr><th>Declaration / year</th><th>Currency</th><th>In-kind flag</th><th>Amount column</th><th>Rows</th><th>Exact sum</th></tr></thead><tbody>'+p.totals.map(t=>'<tr><td>'+esc(t.declaration+' / '+t.year)+'</td><td>'+esc(t.currency)+'</td><td>'+esc(t.inKind===null?'null / unmapped':t.inKind)+'</td><td>'+esc(t.amountRole)+'</td><td>'+t.count+'</td><td class="mono">'+esc(t.exactTotal)+'</td></tr>').join('')+'</tbody></table></div></section>'+
  '<section><h2>Original observations</h2><div class="grid"><label>Search every original cell<input data-query value="'+esc(query)+'"></label><label class="check"><input type="checkbox" data-issues'+(issueOnly?' checked':'')+'>Rows with review findings</label></div><p>'+rows.length+' matching rows. Page '+(page+1)+' of '+Math.max(1,Math.ceil(rows.length/perPage))+'.</p><div class="table-scroll"><table><thead><tr><th>Source row</th><th>Company / project</th><th>Revenue / government</th><th>Reported amount</th><th>Currency / year</th><th>Source</th></tr></thead><tbody>'+display.map(r=>'<tr><td>'+r.record+'</td><td>'+esc(role(r,'company'))+'<small>'+esc(role(r,'project'))+'</small></td><td>'+esc(role(r,'revenue'))+'<small>'+esc(role(r,'government'))+'</small></td><td class="mono">'+esc(role(r,'amount'))+'</td><td>'+esc(role(r,'currency'))+' / '+esc(role(r,'year'))+'</td><td><button data-record="'+esc(r.id)+'">Inspect row</button></td></tr>').join('')+'</tbody></table></div><div class="actions"><button data-action="previous"'+(!page?' disabled':'')+'>Previous page</button><button data-action="next"'+((page+1)*perPage>=rows.length?' disabled':'')+'>Next page</button></div></section>'+
  '<section><h2>Quality and mapping review</h2><p>'+p.issues.length+' findings; '+p.repeatedKeys.length+' repeated business-key groups. The complete profile download retains every finding.</p><ol>'+p.issues.slice(0,50).map(i=>'<li><strong>'+esc(i.code)+'</strong> '+esc(i.record?'Record '+i.record+': ':'')+esc(i.message)+' <button data-review-kind="finding" data-review-id="'+esc(i.id)+'">Review finding</button></li>').join('')+'</ol>'+(p.issues.length>50?'<p>Showing the first 50 findings.</p>':'')+'<h3>Repeated business keys</h3>'+p.repeatedKeys.map(g=>'<p>'+g.count+' original rows <button data-review-kind="repeated-key" data-review-id="'+esc(g.id)+'">Review group</button></p>').join('')+'</section>'+reviewSection(p):'<section><h2>Start with an original export</h2><p>Choose its actual source format, retain its URL and scope, then review the mapped columns. No sample or invented data is loaded.</p></section>')+
  '<dialog aria-labelledby="row-title"></dialog>';
  controls();
 }
 function controls(){root.setAttribute('aria-busy',String(busy));if(busy)for(const e of root.querySelectorAll('button,input,select,textarea'))e.disabled=true;}
 async function run(action){if(busy)return;capture();busy=true;controls();error='';try{await action();}catch(e){error=e.message||String(e);}finally{busy=false;render();if(focusReview){focusReview=false;const form=root.querySelector('[data-review-form]');form?.scrollIntoView?.({block:'start'});form?.querySelector('[name="owner"]')?.focus();}}}
 function rowDialog(id){
  const r=profile.observations.find(x=>x.id===id);if(!r)throw Error('The selected original row is absent.');selected=id;
  const d=root.querySelector('dialog');d.innerHTML='<h2 id="row-title">Original source row '+r.record+'</h2><p class="mono">'+esc(r.id)+'</p><p>'+esc(r.jsonPointer||'Physical CSV line '+r.line)+'</p><div class="table-scroll"><table><thead><tr><th>Exact column</th><th>Source type</th><th>Exact value</th></tr></thead><tbody>'+r.cells.map((c,i)=>'<tr><th>'+esc(profile.headers[i])+'</th><td>'+esc(c.kind)+'</td><td><pre>'+esc(c.kind==='null'?'null':c.raw)+'</pre></td></tr>').join('')+'</tbody></table></div><button data-action="row-download">Download original row projection</button><button data-review-kind="row" data-review-id="'+esc(r.id)+'">Review row</button><button data-action="close">Close row</button>';d.showModal();
 }
 function printBrief(){
  if(!profile)throw Error('Select an original source before printing.');const p=profile;
  const win=window.open('','_blank');if(!win)throw Error('Allow this page to open its management brief for printing.');
  win.document.write('<!doctype html><html><head><meta charset="utf-8"><title>Disclosure source brief</title><style>body{font:14px Arial;color:#151515;background:#fff;max-width:1000px;margin:30px}table{border-collapse:collapse;width:100%}td,th{border:1px solid #999;padding:6px;text-align:left;overflow-wrap:anywhere}pre{white-space:pre-wrap}h1{font-size:24px}@media print{body{margin:0}button{display:none}}</style></head><body><h1>Public disclosure source brief</h1><p>'+esc(p.metadata.scope)+' · '+esc(p.metadata.population)+'</p><p>'+esc(p.coverage.reason)+' '+p.counts.rows+' original rows; '+p.counts.issues+' review findings.</p><p>Source: '+esc(p.metadata.url)+'</p><p>'+esc(p.metadata.representation)+' · '+esc(p.metadata.retrievedAt)+'</p><pre>'+esc(p.sourceSha256)+'</pre><h2>Exact original totals by declaration and currency</h2><table><tr><th>Declaration/year</th><th>Currency/kind</th><th>Column</th><th>Rows</th><th>Exact total</th></tr>'+p.totals.map(t=>'<tr><td>'+esc(t.declaration+' / '+t.year)+'</td><td>'+esc(t.currency+' / '+t.inKind)+'</td><td>'+esc(t.amountRole)+'</td><td>'+t.count+'</td><td>'+esc(t.exactTotal)+'</td></tr>').join('')+'</table><h2>Review findings</h2><ol>'+p.issues.map(i=>'<li>'+esc(i.code+' · '+(i.record?'Record '+i.record+': ':'')+i.message)+'</li>').join('')+'</ol><h2>Saved review decisions</h2>'+p.reviews.map(r=>'<h3>'+esc(r.target.kind+' · '+r.target.id)+'</h3><ol>'+r.history.map(e=>'<li><strong>'+esc(e.status+' · '+e.owner+' · '+e.at)+'</strong><pre>'+esc(e.note)+'</pre><p>'+esc(e.sha256)+'</p></li>').join('')+'</ol>').join('')+'<p>Original rows and all repeated keys remain retained. These totals do not reconcile company payments with government aggregates. The complete workspace preserves exact source content and mapping.</p><button onclick="window.print()">Print this brief</button></body></html>');win.document.close();win.focus();
 }
 root.addEventListener('input',e=>{if(e.target.matches('[data-query]')){query=e.target.value;page=0;const start=e.target.selectionStart;render();const q=root.querySelector('[data-query]');q.focus();q.setSelectionRange(start,start);}else{capture();generation++;}});
 root.addEventListener('change',e=>{
  const el=e.target;
  if(el.matches('[data-issues]')){issueOnly=el.checked;page=0;render();return;}
  if(el.matches('[data-snapshot]')){run(async()=>{workspace=model.select(workspace,el.value);profile=model.profile(workspace);page=0;query='';});return;}
  if(el.matches('[name="format"]')){capture();generation++;refreshHeaders();render();return;}
  if(el.matches('[data-source],[data-open]')){
   const file=el.files?.[0];if(!file)return;capture();const token=++generation,old=workspace;
   run(async()=>{if(file.size>MAX)throw Error('File exceeds 128 MiB.');const raw=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(await file.arrayBuffer());if(token!==generation||old!==workspace)throw Error('A newer source or draft was selected; reopen this file explicitly.');if(el.matches('[data-source]')){draft.content=raw;draft.filename=file.name;refreshHeaders();notice='Original source loaded. Review its scope and exact mappings.';}else{const v=JSON.parse(raw.charCodeAt(0)===0xfeff?raw.slice(1):raw);if(v.schema==='commons.public-disclosure-working-copy.v1'){const opened=model.reopen(JSON.stringify(v.workspace));const openedDraft=checkDraft(v.draft),openedReview=checkedReviewDraft(v.reviewDraft||{snapshotId:null,target:null,status:'open',owner:'',note:''});bounded(raw);workspace=opened;draft=openedDraft;reviewDraft=openedReview;}else workspace=model.reopen(raw);profile=workspace.selected?model.profile(workspace):null;refreshHeaders();notice='Reopened the complete source workspace.';}});
  }
 });
 root.addEventListener('submit',e=>{if(e.target.matches('[data-review-form]')){e.preventDefault();run(async()=>{if(reviewDraft.snapshotId!==workspace.selected)throw Error('Return to the original source snapshot before saving its review.');const result=model.recordReview(workspace,{...reviewDraft,at:now()});workspace=result.workspace;profile=model.profile(workspace);reviewDraft={snapshotId:null,target:null,status:'open',owner:'',note:''};notice=result.replayed?'The same review decision is already saved.':'Saved a new immutable review revision.';generation++;});return;}if(!e.target.matches('[data-import]'))return;e.preventDefault();run(async()=>{if(draft.expectedRows!==''&&!/^\d+$/.test(draft.expectedRows))throw Error('Enter a whole decimal row count or leave it blank.');const count=draft.expectedRows===''?null:Number(draft.expectedRows);const result=model.addSource(workspace,{...draft,expectedRows:count});workspace=model.select(result.workspace,result.snapshotId);profile=model.profile(workspace);page=0;notice=result.replayed?'This exact source edition is already retained.':'Retained the original source, mapping and profile.';generation++;});});
 root.addEventListener('click',e=>{
  const reviewButton=e.target.closest('[data-review-id]');if(reviewButton){run(async()=>{startReview({kind:reviewButton.dataset.reviewKind,id:reviewButton.dataset.reviewId});});return;}
  const record=e.target.closest('[data-record]');if(record){rowDialog(record.dataset.record);return;}
  const button=e.target.closest('[data-action]');if(!button)return;const action=button.dataset.action;
  if(action==='close'){root.querySelector('dialog').close();return;}
  if(action==='row-download'){const row=profile?.observations.find(r=>r.id===selected);if(row)download('original-row-'+row.record+'.json',JSON.stringify({sourceSha256:profile.sourceSha256,headers:profile.headers,...row}));return;}
  run(async()=>{
   if(action==='clear-review'){reviewDraft={snapshotId:null,target:null,status:'open',owner:'',note:''};notice='Cleared the unsaved review fields.';}
   else if(action==='reviews-json')download('disclosure-review-history.json',JSON.stringify({schema:'commons.public-disclosure-review-register.v1',snapshotId:profile.snapshotId,sourceSha256:profile.sourceSha256,reviews:profile.reviews}));
   else if(action==='reviews-csv')download('disclosure-review-history.csv',model.exportReviews(workspace),'text/csv;charset=utf-8');
   else if(action==='save')download('disclosure-working-copy.json',bounded(JSON.stringify(snapshot())));
   else if(action==='editable'){const payload=bounded(JSON.stringify(snapshot())).replace(/</g,'\\u003c');const html=template.replace('<!--DISCLOSURE_STATE-->',()=>payload);bounded(html);download('disclosure-handover.html',html,'text/html;charset=utf-8');}
   else if(action==='original'){const s=model.source(workspace);original('original-source.'+(s.format==='csv'?'csv':'json'),s.content);}
   else if(action==='profile')download('disclosure-profile.json',JSON.stringify(profile));
   else if(action==='csv')download('disclosure-observations.csv',model.exportObservations(workspace),'text/csv;charset=utf-8');
   else if(action==='print')printBrief();
   else if(action==='previous')page=Math.max(0,page-1);
   else if(action==='next')page++;
  });
 });
 draft=checkDraft(draft);reviewDraft=checkedReviewDraft(reviewDraft);refreshHeaders();render();return {snapshot,workspace:()=>clone(workspace)};
}
