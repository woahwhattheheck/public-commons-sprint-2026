/** Source-shaped return over the original Measurements writer. No scientific mutation. */
const SCHEMA='upper-savannah.source-handback-draft/v1';
const MAX_DRAFT=2*1024*1024,MAX_BUNDLE=256*1024*1024,MAX_RECEIVE=90*1024*1024;
const clone=v=>JSON.parse(JSON.stringify(v));
const plain=v=>v&&typeof v==='object'&&!Array.isArray(v);
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const stable=v=>JSON.stringify(v,(_,x)=>plain(x)?Object.fromEntries(Object.keys(x).sort().map(k=>[k,x[k]])):x);
const hash=/^[a-f0-9]{64}$/;
const text=v=>typeof v==='string'?v:JSON.stringify(v);
function need(ok,message){if(!ok)throw Error(message);}
function ids(v){need(Array.isArray(v)&&v.length<=10000&&v.every(x=>typeof x==='string'&&x.length>0&&x.length<=256)&&new Set(v).size===v.length,'Retain unique original source/result identifiers.');return [...v];}
function draft(v){need(plain(v)&&typeof v.title==='string'&&v.title.length<=240&&typeof v.note==='string'&&v.note.length<=12000,'Retain the complete title and note.');return {sourceIds:ids(v.sourceIds),exportIds:ids(v.exportIds),title:v.title,note:v.note};}
export function receiveSourceHandbackDraft(value){
  need(plain(value)&&value.schema===SCHEMA,'Choose an original source-return working file.');
  const out={schema:SCHEMA,draft:draft(value.draft),pending:null,selectedEditionId:value.selectedEditionId||''};
  need(typeof out.selectedEditionId==='string'&&out.selectedEditionId.length<=256,'Retain the original selected edition.');
  if(value.pending!==null&&value.pending!==undefined){
    const p=value.pending;need(plain(p)&&plain(p.body)&&typeof p.startedAt==='string'&&Number.isFinite(Date.parse(p.startedAt)),'Retain the exact pending publication.');
    const body={expectedRevision:p.body.expectedRevision,previewSha256:p.body.previewSha256,...draft(p.body)};
    need(hash.test(body.previewSha256||'')&&hash.test(p.requestFingerprint||''),'Retain the original preview and publication fingerprints.');
    need(Number.isSafeInteger(body.expectedRevision)&&body.expectedRevision>=0&&body.sourceIds.length>0&&body.title.trim(),'Retain the exact publication revision and source selection.');
    need(stable(draft(body))===stable(out.draft),'The pending publication must match the retained form.');
    out.pending={body,startedAt:p.startedAt,requestFingerprint:p.requestFingerprint};
  }
  return out;
}
function saveFile(content,filename,type='application/json'){
  const url=URL.createObjectURL(new Blob([content],{type})),a=document.createElement('a');a.href=url;a.download=filename;a.click();setTimeout(()=>URL.revokeObjectURL(url),30000);
}
async function digest(bytes){const value=await crypto.subtle.digest('SHA-256',bytes);return Array.from(new Uint8Array(value),b=>b.toString(16).padStart(2,'0')).join('');}
function decode(value){
  need(typeof value==='string'&&value.length<=Math.ceil(MAX_BUNDLE/3)*4+4&&value.length%4===0&&!/[^A-Za-z0-9+/=]/.test(value),'The returned archive is not complete bounded Base64.');
  const padding=value.endsWith('==')?2:value.endsWith('=')?1:0,firstPad=value.indexOf('=');
  need(firstPad<0||firstPad===value.length-padding,'The returned archive has misplaced Base64 padding.');
  if(padding){const alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/',last=alphabet.indexOf(value[value.length-padding-1]);need(last>=0&&(last&(padding===2?15:3))===0,'The returned archive has noncanonical Base64 padding bits.');}
  const binary=atob(value),bytes=new Uint8Array(binary.length);for(let i=0;i<binary.length;i++)bytes[i]=binary.charCodeAt(i);return bytes;
}
function encode(bytes){let binary='';for(let i=0;i<bytes.length;i+=32768)binary+=String.fromCharCode(...bytes.subarray(i,i+32768));return btoa(binary);}
async function requestHash(body){return digest(new TextEncoder().encode(stable({format:'upper-savannah-source-handback/v1',request:body})));}
function rowReview(row){
  const issues=(row.issues||[]).map(x=>'<li>'+esc(x)+'</li>').join('');
  return (issues?'<ul>'+issues+'</ul>':'<p>No retained issue reason for this source row.</p>')+
    (row.records||[]).map(r=>'<dl><dt>Record</dt><dd>'+esc(r.id)+'</dd><dt>Station / native reach</dt><dd>'+esc(r.stationId)+' / '+esc(r.mapping?.reachId||'Unassigned')+'</dd><dt>Reported value / unit</dt><dd>'+esc(r.reportedValue)+' '+esc(r.reportedUnit)+'</dd><dt>Normalized value / unit</dt><dd>'+esc(r.value??'Unresolved')+' '+esc(r.unit)+'</dd><dt>Constituent / fraction / basis</dt><dd>'+esc(r.characteristic)+' / '+esc(r.fraction)+' / '+esc(r.basis)+'</dd><dt>Source date / time / timezone</dt><dd>'+esc(r.sampledDate)+' / '+esc(r.sourceTime||r.sampledAt||'Not provided')+' / '+esc(r.timeZone||'Not provided')+'</dd><dt>Censor / lower / upper</dt><dd>'+esc(r.censor)+' / '+esc(r.lower??'Unresolved')+' / '+esc(r.upper??'Unresolved')+'</dd><dt>Review</dt><dd>'+esc(r.review?.state||'Not provided')+' '+esc(r.review?.rationale||r.review?.note||'')+'</dd><dt>Eligibility</dt><dd>'+esc(r.eligible?.ok===true?'Eligible':r.eligible?.ok===false?'Excluded':'Unresolved')+' '+esc((r.eligible?.reasons||[]).join('; '))+'</dd></dl>').join('')+
    '<details><summary>Complete original record and row data</summary><pre>'+esc(JSON.stringify({records:row.records,station:row.station,rejections:row.rejections,review:row.review},null,2))+'</pre></details>';
}
function rowResults(row){
  const values=row.results||[];
  return values.length?values.map(r=>'<p><strong>'+esc(r.kind)+'</strong><br>Saved revision '+esc(r.revision)+' · '+esc(r.state)+' · '+esc(r.role)+'<br><span class="sh-meta">'+esc(r.exportId)+'</span></p><details><summary>Exact retained result values</summary><pre>'+esc(JSON.stringify(r.value,null,2))+'</pre></details>').join(''):'<p>No selected saved result is linked to this original row.</p>';
}
function countHtml(counts){return plain(counts)?'<dl class="sh-counts">'+Object.entries(counts).map(([k,v])=>'<div><dt>'+esc(k.replace(/([a-z])([A-Z])/g,'$1 $2').replaceAll('_',' '))+'</dt><dd>'+esc(text(v))+'</dd></div>').join('')+'</dl>':'<p>Counts are unavailable in this response.</p>';}
function validateDeliveryContext(value){
 if(value.deliveryEdition===undefined||value.deliveryEdition===1)return null;
 need(value.deliveryEdition===2,'This return uses a newer delivery edition. Open it in the matching Measurements version.');
 const c=value.deliveryContext;
 need(plain(c)&&hash.test(c.projectSha256||'')&&hash.test(c.contextSha256||'')&&plain(c.project)&&Array.isArray(c.collections)&&typeof c.bindingNote==='string','The full included-project preview is incomplete.');
 for(const key of ['revision','imports','records','savedResults','intakeEditions'])need(Number.isSafeInteger(c.project[key])&&c.project[key]>=0,'The included native project count is incomplete.');
 need(c.project.revision===value.revision,'The included project differs from the selected Measurements revision.');
 const collectionIds=new Set();
 for(const collection of c.collections){
  need(plain(collection)&&hash.test(collection.id||'')&&!collectionIds.has(collection.id)&&typeof collection.title==='string'&&Array.isArray(collection.files),'The companion collection inventory is incomplete.');collectionIds.add(collection.id);
  const paths=new Set();
  for(const f of collection.files){need(plain(f)&&typeof f.path==='string'&&f.path&&!paths.has(f.path)&&typeof f.kind==='string'&&(f.importId===null||typeof f.importId==='string')&&Number.isSafeInteger(f.bytes)&&f.bytes>=0&&hash.test(f.sha256||''),'The included companion file identity is incomplete.');paths.add(f.path);}
 }
 return c;
}
function deliveryContextHtml(value){
 const c=validateDeliveryContext(value);if(!c)return '<p class="sh-muted">This retained return uses the original delivery edition. Its saved manifest lists the complete files.</p>';
 const count=c.collections.reduce((n,x)=>n+x.files.length,0),p=c.project;
 return '<section class="sh-panel"><h4>Complete project accompanying these rows</h4><p>The return includes the whole native project: <strong>'+esc(p.imports)+'</strong> imports, <strong>'+esc(p.records)+'</strong> measurements, <strong>'+esc(p.savedResults)+'</strong> saved results and <strong>'+esc(p.intakeEditions)+'</strong> intake editions. This includes imports and saved results outside the selected row returns.</p><p>'+esc(c.collections.length)+' matching source collections include '+esc(count)+' original files and companions. Their exact inventory is included in this preview.</p><details><summary>Included original companion files</summary>'+(count?'<div class="sh-scroll"><table><thead><tr><th>Collection</th><th>Original file</th><th>Source type</th><th>Bytes</th><th>SHA-256</th></tr></thead><tbody>'+c.collections.flatMap(x=>x.files.map(f=>'<tr><td>'+esc(x.title||x.id)+'</td><td>'+esc(f.path)+'</td><td>'+esc(f.kind)+'</td><td>'+esc(f.bytes)+'</td><td class="sh-meta">'+esc(f.sha256)+'</td></tr>')).join('')+'</tbody></table></div>':'<p>No matching collection companions accompany this selection.</p>')+'</details><details><summary>Complete project identity</summary><p class="sh-meta">Project SHA-256 '+esc(c.projectSha256)+'<br>Native context SHA-256 '+esc(c.contextSha256)+'</p><p>'+esc(c.bindingNote)+'</p></details></section>';
}
function manifest(value){
  need(plain(value)&&typeof value.id==='string'&&value.id&&Number.isSafeInteger(value.revision)&&Array.isArray(value.files),'The operator did not return a complete saved edition.');
  need(value.requestFingerprint===value.id&&hash.test(value.id)&&plain(value.selection),'Retain the exact saved publication fingerprint and selection.');
  for(const f of value.files)need(plain(f)&&typeof f.name==='string'&&Number.isSafeInteger(f.bytes)&&f.bytes>=0&&hash.test(f.sha256),'A saved member is missing its complete identity.');
  return value;
}
export function mountSourceHandback(container,{request,refresh=async()=>{},initialState=null,onStateChange=()=>{},css='/measurements/source_handback.css'}={}){
  need(container&&typeof container.replaceChildren==='function'&&typeof request==='function','Use the original Measurements container and request transport.');
  let state=initialState?receiveSourceHandbackDraft(initialState):{schema:SCHEMA,draft:{sourceIds:[],exportIds:[],title:'',note:''},pending:null,selectedEditionId:''};
  let active=true,busy=false,catalog=null,preview=null,previewBasis='',edition=null,sourceId='',page=0,query='',generation=0,statusText='Opening retained sources and results…',errorText='',rejectedFile=null,editionView=null,resumeAllowed=false;
  const root=document.createElement('section');root.className='source-handback';container.replaceChildren(root);
  const controller=new AbortController();
  let style=document.querySelector('link[data-source-handback-style]');
  if(!style){style=document.createElement('link');style.rel='stylesheet';style.href=css;style.dataset.sourceHandbackStyle='true';document.head.append(style);}
  const live=()=>active&&root.isConnected;
  const current=()=>{need(live(),'Reopen Source-shaped return in the original Measurements workspace.');};
  function notify(){if(live())onStateChange(clone(state));}
  function invalidate(){generation++;preview=null;previewBasis='';page=0;}
  function say(message,error=false){statusText=error?'':message;errorText=error?message:'';const el=root.querySelector('[data-status]');if(el){el.textContent=errorText||statusText;el.setAttribute('role',error?'alert':'status');}}
  function guard(){const ticket=generation,signature=stable(state);return()=>{current();need(generation===ticket&&stable(state)===signature,'This source selection or working form changed during the read. Current work remains intact.');};}
  function controls(){for(const n of root.querySelectorAll('button,input,select,textarea')){const recovery=n.dataset.action==='save-draft';n.disabled=busy&&!recovery||n.dataset.fixed==='true'||!!state.pending&&!recovery&&n.dataset.pendingLock==='true';}root.setAttribute('aria-busy',String(busy));}
  async function run(fn){if(!live()||busy)return;busy=true;controls();try{await fn();}catch(error){if(live()){say(error.message||String(error),true);render();}}finally{busy=false;if(live())controls();}}
  async function api(path='',method='GET',body){
    const response=await request('/handbacks'+path,method,body);const raw=await response.text();let value;
    try{value=JSON.parse(raw);}catch{const e=Error('The operator returned an unreadable response. Keep the retained request and refresh saved editions.');e.status=response.status;throw e;}
    if(!response.ok){const e=Error(typeof value.error==='string'?value.error:value.error?.message||value.message||'The original operator rejected this request.');e.status=response.status;throw e;}return value;
  }
  function missing(){
    if(!catalog)return [];
    return [...state.draft.sourceIds.filter(id=>!catalog.sources.some(x=>x.id===id)).map(id=>'Source '+id),...state.draft.exportIds.filter(id=>!catalog.results.some(x=>x.id===id)).map(id=>'Result '+id)];
  }
  function selectionRows(list,selected,type){
    if(!list.length)return '<p class="sh-muted">No retained '+(type==='source'?'sources':'results')+' are available.</p>';
    return list.map(item=>'<label class="sh-choice"><input type="checkbox" data-selection="'+type+'" value="'+esc(item.id)+'" '+(selected.includes(item.id)?'checked ':'')+'data-pending-lock="true"><span><strong>'+esc(item.label||item.title||item.kind||item.id)+'</strong><span class="sh-meta">'+esc(item.kind||'')+' · '+esc(item.id)+'</span>'+(item.sha?'<span class="sh-meta">Original SHA-256 '+esc(item.sha)+'</span>':'')+(item.revision!==undefined?'<span class="sh-meta">Saved revision '+esc(item.revision)+(item.createdAt?' · '+esc(item.createdAt):'')+'</span>':'')+(item.summary?'<span class="sh-meta">'+esc(text(item.summary))+'</span>':'')+'</span></label>').join('');
  }
  function sourceTable(){
    if(!preview)return '<p class="sh-muted">Select complete original files and any retained results, then preview. Original values remain separate from reviewed fields.</p>';
    const sources=preview.sources;const source=sources.find(x=>x.id===sourceId)||sources[0];
    if(!source)return '<p>No source rows were returned.</p>';sourceId=source.id;
    const rows=source.rows.filter(row=>!query||JSON.stringify(row).toLowerCase().includes(query.toLowerCase()));page=Math.min(page,Math.max(0,Math.ceil(rows.length/50)-1));
    const visible=rows.slice(page*50,page*50+50),surplus=source.rows.reduce((n,r)=>Math.max(n,Array.isArray(r.values)?r.values.length-source.headers.length:0),0),columns=[...source.headers,...Array.from({length:surplus},(_,i)=>'Original surplus field '+(i+1))];
    return '<div class="sh-toolbar"><label>Original file<select data-source-page>'+sources.map(x=>'<option value="'+esc(x.id)+'"'+(x.id===sourceId?' selected':'')+'>'+esc(x.label||x.id)+'</option>').join('')+'</select></label><label>Find original or reviewed text<input data-find value="'+esc(query)+'"></label><button type="button" data-action="filter">Find rows</button></div>'+
      '<p>'+source.rows.length+' complete source rows; '+rows.length+' match this view. Page '+(page+1)+' of '+Math.max(1,Math.ceil(rows.length/50))+'. Filtering changes only this view; publication includes every original row.</p>'+
      countHtml(source.counts)+'<div class="sh-toolbar"><button type="button" data-action="previous" '+(page?'':'data-fixed="true"')+'>Previous 50</button><button type="button" data-action="next" '+((page+1)*50<rows.length?'':'data-fixed="true"')+'>Next 50</button><button type="button" data-action="original">Download unchanged original</button><button type="button" data-action="source-json">Download complete row review</button></div>'+
      '<div class="sh-scroll" tabindex="0" aria-label="Original source values and separate review fields"><table><thead><tr><th>Original source line</th>'+columns.map(h=>'<th>'+esc(h)+'</th>').join('')+'<th>Original record IDs</th><th>Review status</th><th>Eligible</th><th>Review and reasons</th><th>Retained result links</th></tr></thead><tbody>'+
      visible.map(row=>'<tr><th scope="row">'+esc(row.line)+'</th>'+columns.map((h,i)=>'<td class="sh-original">'+esc(Array.isArray(row.values)?row.values[i]:row.values?.[h])+'</td>').join('')+'<td>'+esc((row.recordIds||[]).join('\n'))+'</td><td>'+esc(row.status)+'</td><td>'+esc(row.eligible===null?'Unresolved':row.eligible)+'</td><td><details><summary>Inspect review / issues</summary>'+rowReview(row)+'</details></td><td><details><summary>Inspect result references</summary>'+rowResults(row)+'</details></td></tr>').join('')+
      '</tbody></table></div><details><summary>Complete source accounting</summary><pre>'+esc(JSON.stringify({id:source.id,kind:source.kind,counts:source.counts,headers:source.headers,leadingBlankRows:source.leadingBlankRows,originalSummary:source.originalSummary,mapping:source.mapping,origin:source.origin},null,2))+'</pre></details>';
  }
  function savedTable(){
    const value=editionView;if(!value)return '';const sources=value.sources||[];
    return sources.map(source=>'<details><summary>'+esc(source.label||source.id)+' · '+source.rows.length+' complete original rows</summary>'+countHtml(source.counts)+'<button type="button" data-saved-source="'+esc(source.id)+'">View this saved source in row reader</button><button type="button" data-original-member="'+esc(edition.sources?.find(x=>x.id===source.id)?.originalPath||'')+'" '+(!edition.sources?.find(x=>x.id===source.id)?.originalPath?'disabled':'')+'>Download saved original bytes</button><pre>'+esc(JSON.stringify({headers:source.headers,counts:source.counts},null,2))+'</pre></details>').join('');
  }
  function editionHtml(){
    if(!edition)return '<p class="sh-muted">Open a retained edition to inspect every member and download its complete archive.</p>';
    return '<h3>'+esc(edition.title||edition.id)+'</h3><p>Saved revision '+esc(edition.revision)+' · '+esc(edition.createdAt||'')+'</p><p>'+esc(edition.note||'')+'</p><p class="sh-meta">'+esc(edition.id)+'</p>'+countHtml(edition.counts)+
      '<div class="sh-scroll"><table><thead><tr><th>Original package member</th><th>Bytes</th><th>SHA-256</th></tr></thead><tbody>'+edition.files.map(f=>'<tr><td>'+esc(f.name)+'</td><td>'+esc(f.bytes)+'</td><td class="sh-meta">'+esc(f.sha256)+'</td></tr>').join('')+'</tbody></table></div>'+
      '<div class="sh-toolbar"><button type="button" data-action="bundle">Download complete verified ZIP</button><button type="button" data-action="manifest">Download edition manifest</button><button type="button" data-action="edition-view">Inspect saved source rows</button></div>'+(editionView?'<p>Saved source rows are shown below from the immutable edition.</p>'+deliveryContextHtml(editionView)+savedTable():'')+'<details><summary>Complete retained edition</summary><pre>'+esc(JSON.stringify(edition,null,2))+'</pre></details>';
  }
  function render(){
    if(!live())return;const absent=missing(),ready=!!preview&&previewBasis===stable({revision:catalog?.revision,draft:state.draft})&&!state.pending;
    root.innerHTML='<header><p class="sh-eyebrow">MEASUREMENTS / SOURCE RETURN</p><p class="sh-muted">Prepared by TokenJunkieLabs</p><h2>Return reviewed results with the original files</h2><p>Keep every original row and file. Review the current source links, eligibility and retained result references before creating a complete return edition.</p></header>'+
      '<p data-status role="'+(errorText?'alert':'status')+'" aria-live="polite">'+esc(errorText||statusText)+'</p>'+
      '<div class="sh-toolbar"><button type="button" data-action="refresh">Refresh original workspace</button><button type="button" data-action="save-draft">Save selection and unfinished title</button><button type="button" data-action="choose-draft" data-pending-lock="true">Reopen saved selection</button><button type="button" data-action="choose-zip" data-pending-lock="true">Receive complete return ZIP</button><input hidden type="file" data-draft-file accept=".json,application/json"><input hidden type="file" data-return-file accept=".zip,application/zip"></div>'+
      (state.pending?'<section class="sh-warning"><h3>Publication outcome needs reconciliation</h3><p>The exact original request is retained. Refresh saved editions before attempting another publication. Download this working file to preserve the request.</p><pre>'+esc(JSON.stringify(state.pending,null,2))+'</pre><button type="button" data-action="reconcile">Check original publication</button><button type="button" data-action="resume-original" '+(!resumeAllowed?'data-fixed="true"':'')+'>Resume exact original publication</button></section>':'')+
      (absent.length?'<section class="sh-warning"><h3>Selected originals are not in the current list</h3><p>'+esc(absent.join('; '))+'</p><p>Selections remain retained. Restore the original workspace or explicitly change the selection.</p></section>':'')+
      '<div class="sh-grid"><section class="sh-panel"><h3>1. Complete original sources</h3>'+selectionRows(catalog?.sources||[],state.draft.sourceIds,'source')+'</section><section class="sh-panel"><h3>2. Retained results to accompany them</h3><p>Choose saved outputs. This return does not run or change scientific calculations.</p>'+selectionRows(catalog?.results||[],state.draft.exportIds,'result')+'</section></div>'+
      '<section class="sh-panel"><h3>3. Review the whole source population</h3><div class="sh-fields"><label>Return title<input data-field="title" maxlength="240" data-pending-lock="true" value="'+esc(state.draft.title)+'"></label><label>Source and decision note<textarea data-field="note" maxlength="12000" data-pending-lock="true">'+esc(state.draft.note)+'</textarea></label></div>'+
      '<div class="sh-toolbar"><button type="button" data-action="preview" data-pending-lock="true" '+(!catalog||!state.draft.sourceIds.length||absent.length?'data-fixed="true"':'')+'>Preview every selected source row</button><button type="button" data-action="publish" data-pending-lock="true" '+(!ready||!state.draft.title.trim()?'data-fixed="true"':'')+'>Publish reviewed return edition</button></div>'+
      (preview?'<p>Preview of original workspace revision '+esc(preview.revision)+'.</p>'+countHtml(preview.counts)+deliveryContextHtml(preview)+'<details><summary>Selected saved scientific results</summary>'+(preview.results||[]).map(r=>'<p>'+esc(r.kind)+' · original revision '+esc(r.revision)+' · '+esc(r.id)+' <button type="button" data-result-export="'+esc(r.id)+'">Download exact retained result</button></p>').join('')+'</details>':'')+sourceTable()+'</section>'+
      '<section class="sh-panel"><h3>4. Reopen a retained return</h3><div class="sh-toolbar"><label>Saved return edition<select data-edition><option value="">Choose a retained edition</option>'+(catalog?.editions||[]).map(e=>'<option value="'+esc(e.id)+'"'+(state.selectedEditionId===e.id?' selected':'')+'>'+esc(e.title||e.id)+' · revision '+esc(e.revision)+'</option>').join('')+'</select></label><button type="button" data-action="open">Open exact saved edition</button></div>'+editionHtml()+'</section>'+
      (rejectedFile?'<section class="sh-warning"><p>The selected working file was retained after the failed receive.</p><button type="button" data-action="rejected">Download exact selected file</button></section>':'')+
      '<p class="sh-muted">An original spreadsheet is preserved as supplied. The reviewed companion describes row and cell lineage; this workflow does not silently rewrite formulas, labels, units, dates or untouched cells. Use the existing complete workspace receiver to restore the scientific workspace.</p>';
    controls();
  }
  async function loadCatalog(){
    const check=guard(),value=await api();need(plain(value)&&Number.isSafeInteger(value.revision)&&Array.isArray(value.sources)&&Array.isArray(value.results)&&Array.isArray(value.editions),'The operator returned an incomplete source-return catalogue.');check();
    catalog=value;if(preview&&preview!==editionView&&preview.revision!==catalog.revision){preview=null;previewBasis='';}render();
  }
  async function openEdition(id){need(typeof id==='string'&&id,'Choose a retained return edition.');const check=guard(),value=manifest(await api('/'+encodeURIComponent(id)));check();need(value.id===id,'The returned edition does not match the selected original.');edition=value;editionView=null;state.selectedEditionId=id;notify();render();}
  async function dispatchPending(){
    need(state.pending,'Retain the original pending publication.');const pending=clone(state.pending);
    need(await requestHash(pending.body)===pending.requestFingerprint,'The retained original request does not match its fingerprint.');current();resumeAllowed=false;
    let value;try{value=await api('','POST',pending.body);}catch(error){
      if(Number.isInteger(error.status)&&error.status>=400&&error.status<500&&![401,403,408,425,429].includes(error.status)){state.pending=null;notify();render();}
      throw error;
    }
    current();need(state.pending?.requestFingerprint===pending.requestFingerprint,'The retained original request changed during publication.');
    edition=manifest(value);need(edition.id===pending.requestFingerprint&&stable(edition.selection)===stable(pending.body),'The publication reply does not match the exact original request. Keep it for recovery.');
    editionView=null;state.selectedEditionId=edition.id;state.pending=null;notify();preview=null;previewBasis='';await loadCatalog();render();say('Published and reopened the complete original return edition. Download its verified archive below.');await refresh();
  }
  async function reconcile(){
    await loadCatalog();current();if(!state.pending)return;
    const body=state.pending.body;
    need(await requestHash(body)===state.pending.requestFingerprint,'The retained original request fingerprint does not match its body.');
    const matches=(catalog.editions||[]).filter(e=>e.id===state.pending.requestFingerprint&&e.requestFingerprint===e.id);
    if(matches.length===1){const pending=state.pending;await openEdition(matches[0].id);current();need(edition.id===pending.requestFingerprint&&stable(edition.selection)===stable(pending.body),'The candidate edition does not match the full original request.');state.pending=null;resumeAllowed=false;notify();render();say('Recovered the exact original publication. Its complete saved edition is open.');}
    else {resumeAllowed=matches.length===0;render();say(matches.length?'More than one candidate is present. Keep the original request for operator review.':'No exact original publication is visible. You can resume the same retained request; its native deterministic identity prevents a duplicate edition.',true);}
  }
  root.addEventListener('input',event=>{
    if(busy||state.pending)return;const key=event.target.dataset.field;if(key){state.draft[key]=event.target.value;invalidate();notify();const publish=root.querySelector('[data-action=publish]');if(publish){publish.dataset.fixed='true';publish.disabled=true;}}
    if(event.target.matches('[data-find]'))query=event.target.value;
  },{signal:controller.signal});
  root.addEventListener('change',event=>{
    if(busy)return;const type=event.target.dataset.selection;
    if(type&&!state.pending){const key=type==='source'?'sourceIds':'exportIds',id=event.target.value;state.draft[key]=event.target.checked?[...state.draft[key],id]:state.draft[key].filter(x=>x!==id);invalidate();notify();render();return;}
    if(event.target.matches('[data-source-page]')){sourceId=event.target.value;page=0;query='';render();return;}
    if(event.target.matches('[data-edition]')){state.selectedEditionId=event.target.value;edition=null;generation++;notify();return;}
    if(event.target.matches('[data-return-file]')&&!state.pending){
      const file=event.target.files?.[0],ticket=++generation;rejectedFile=file||null;if(!file){render();return;}
      void run(async()=>{need(file.size<=MAX_RECEIVE,'This browser receiver accepts complete ZIPs up to 90 MiB. Use the maintained source-handback CLI for a larger complete archive; no partial file is uploaded.');const before=stable(state),buffer=await file.arrayBuffer(),bytes=new Uint8Array(buffer),sha256=await digest(bytes);current();need(ticket===generation&&event.target.files?.[0]===file&&stable(state)===before,'The archive selection changed during its read.');const value=manifest(await api('/receive','POST',{contentBase64:encode(bytes),sha256}));current();need(ticket===generation&&stable(state)===before,'The working selection changed during archive receiving.');edition=value;editionView=null;state.selectedEditionId=value.id;rejectedFile=null;notify();await loadCatalog();render();say('Received and opened the complete readonly return edition. Current scientific measurements were not changed.');});return;
    }
    if(event.target.matches('[data-draft-file]')&&!state.pending){
      const file=event.target.files?.[0],ticket=++generation;rejectedFile=file||null;if(!file){render();return;}
      void run(async()=>{need(file.size<=MAX_DRAFT,'Choose a source-return working file within 2 MiB.');const before=stable(state),bytes=await file.arrayBuffer();current();need(ticket===generation&&event.target.files?.[0]===file&&stable(state)===before,'The selection changed while the working file was read.');const raw=new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(bytes),next=receiveSourceHandbackDraft(JSON.parse(raw));if(next.pending)need(await requestHash(next.pending.body)===next.pending.requestFingerprint,'The received original request differs from its fingerprint.');current();need(ticket===generation&&event.target.files?.[0]===file&&stable(state)===before,'The selected working file changed during verification.');
        saveFile(JSON.stringify(state,null,2)+'\n','source-return-before-receive.json');state=next;rejectedFile=null;resumeAllowed=false;invalidate();edition=null;notify();await loadCatalog();render();say('Reopened the complete selection and original pending request, if any. Preview again before a new publication.');});
    }
  },{signal:controller.signal});
  root.addEventListener('click',event=>{
    const resultButton=event.target.closest('[data-result-export]');if(resultButton&&root.contains(resultButton)&&!busy){event.preventDefault();const result=preview?.results.find(x=>x.id===resultButton.dataset.resultExport);if(result)saveFile(JSON.stringify(result,null,2)+'\n','saved-result-'+result.id+'.json');return;}
    const saved=event.target.closest('[data-saved-source],[data-original-member]');if(saved&&root.contains(saved)&&!busy){event.preventDefault();if(saved.dataset.savedSource){const source=editionView?.sources.find(x=>x.id===saved.dataset.savedSource);if(source){preview=editionView;previewBasis='';sourceId=source.id;page=0;query='';render();say('Inspecting immutable saved rows. New publication requires a fresh current-workspace preview.');}return;}const name=saved.dataset.originalMember;if(name&&edition)void run(async()=>{const check=guard(),meta=edition.files.find(x=>x.name===name);need(meta,'Retain the original member identity.');const response=await request('/handbacks/'+encodeURIComponent(edition.id)+'/files?name='+encodeURIComponent(name),'GET');need(response.ok,'The saved original download failed.');const bytes=typeof response.arrayBuffer==='function'?await response.arrayBuffer():new TextEncoder().encode(await response.text());need(bytes.byteLength===meta.bytes&&await digest(bytes)===meta.sha256,'The saved original differs from its retained identity.');check();saveFile(bytes,name.split('/').at(-1),'application/octet-stream');});return;}
    const button=event.target.closest('[data-action]');if(!button||!root.contains(button))return;event.preventDefault();const action=button.dataset.action;
    if(action==='save-draft'){saveFile(JSON.stringify(state,null,2)+'\n','source-return-working.json');return;}
    if(busy)return;
    if(action==='choose-draft'||action==='choose-zip'){if(state.pending)return;const input=root.querySelector(action==='choose-draft'?'[data-draft-file]':'[data-return-file]');input.value='';input.click();return;}
    if(action==='rejected'&&rejectedFile){saveFile(rejectedFile,rejectedFile.name,rejectedFile.type||'application/octet-stream');return;}
    if(action==='filter'){page=0;render();return;}
    if(action==='previous'||action==='next'){page=Math.max(0,page+(action==='next'?1:-1));render();return;}
    if(action==='manifest'&&edition){saveFile(JSON.stringify(edition,null,2)+'\n',edition.id+'-manifest.json');return;}
    if(action==='source-json'&&preview){const source=preview.sources.find(x=>x.id===sourceId)||preview.sources[0];saveFile(JSON.stringify(source,null,2)+'\n','source-row-review.json');return;}
    void run(async()=>{
      if(action==='refresh'){await loadCatalog();say('Refreshed saved sources and editions. All selections and unfinished fields remain.');return;}
      if(action==='reconcile'){await reconcile();return;}
      if(action==='resume-original'){need(resumeAllowed&&state.pending,'First check the exact original publication in the current edition list.');await dispatchPending();return;}
      if(action==='open'){await openEdition(state.selectedEditionId);say('Opened the exact saved return edition.');return;}
      if(action==='original'){const source=preview?.sources.find(x=>x.id===sourceId);need(source,'Preview an original source first.');const check=guard(),saved=preview===editionView&&edition?edition.sources?.find(x=>x.id===source.id):null;const path=saved?'/handbacks/'+encodeURIComponent(edition.id)+'/files?name='+encodeURIComponent(saved.originalPath):'/sources/'+encodeURIComponent(source.id)+'/original';const response=await request(path,'GET');need(response.ok,'The original source download failed.');const bytes=typeof response.arrayBuffer==='function'?await response.arrayBuffer():new TextEncoder().encode(await response.text());check();const expected=saved?saved.sha256:catalog.sources.find(x=>x.id===source.id)?.sha;need(hash.test(expected||'')&&await digest(bytes)===expected,'The downloaded original differs from its retained SHA-256.');check();saveFile(bytes,saved?saved.originalPath.split('/').at(-1):(source.label||source.id).replace(/[\\/:*?"<>|]/g,'_'),response.headers?.get('content-type')||'application/octet-stream');say('Downloaded unchanged original source bytes.');return;}
      if(action==='preview'){
        need(!state.pending&&catalog&&state.draft.sourceIds.length&&!missing().length,'Select retained complete sources before preview.');const check=guard(),body={expectedRevision:catalog.revision,sourceIds:[...state.draft.sourceIds],exportIds:[...state.draft.exportIds]},value=await api('/preview','POST',body);check();
        need(value.revision===body.expectedRevision&&hash.test(value.previewSha256||'')&&Array.isArray(value.sources),'Preview does not match the original workspace revision.');for(const source of value.sources)need(body.sourceIds.includes(source.id)&&Array.isArray(source.headers)&&source.headers.every(h=>typeof h==='string')&&Array.isArray(source.rows),'The preview is missing complete original columns or rows.');
        need(value.sources.length===body.sourceIds.length&&new Set(value.sources.map(s=>s.id)).size===body.sourceIds.length,'Every selected source must appear once in the complete preview.');validateDeliveryContext(value);preview=value;previewBasis=stable({revision:catalog.revision,draft:state.draft});sourceId=value.sources.some(s=>s.id===sourceId)?sourceId:value.sources[0]?.id||'';page=0;render();say('Reviewed the complete original source population. All rows remain in the return, including rejected and unmatched rows.');return;
      }
      if(action==='publish'){
        need(!state.pending&&catalog&&preview&&previewBasis===stable({revision:catalog.revision,draft:state.draft})&&state.draft.title.trim(),'Preview the complete current source selection and enter a return title.');
        const body={expectedRevision:catalog.revision,previewSha256:preview.previewSha256,...clone(state.draft)},fingerprint=await requestHash(body);current();
        state.pending={body,requestFingerprint:fingerprint,startedAt:new Date().toISOString()};notify();render();
        saveFile(JSON.stringify(state,null,2)+'\n','source-return-pending-'+fingerprint.slice(0,12)+'.json');
        await dispatchPending();return;
      }
      if(action==='edition-view'){need(edition,'Open an exact saved edition first.');const check=guard(),value=await api('/'+encodeURIComponent(edition.id)+'/view');check();need(plain(value)&&Array.isArray(value.sources)&&value.sources.every(s=>Array.isArray(s.headers)&&Array.isArray(s.rows)),'The saved edition view is incomplete.');validateDeliveryContext(value);editionView=value;render();say('Opened complete immutable source rows and lineage from the retained edition.');return;}
      if(action==='bundle'){
        need(edition,'Open a saved edition first.');const id=edition.id,check=guard(),value=await api('/'+encodeURIComponent(id)+'/bundle');check();need(plain(value)&&typeof value.filename==='string'&&!/[\\/\0]/.test(value.filename)&&Number.isSafeInteger(value.bytes)&&value.bytes>=0&&value.bytes<=MAX_BUNDLE&&hash.test(value.sha256),'The bundle response is missing its complete identity.');const bytes=decode(value.contentBase64);need(bytes.length===value.bytes&&await digest(bytes)===value.sha256,'The complete archive does not match its declared byte count and SHA-256.');check();saveFile(bytes,value.filename,'application/zip');say('Downloaded the complete archive after verifying its exact bytes and SHA-256.');return;
      }
    });
  },{signal:controller.signal});
  render();void run(loadCatalog);
  return {snapshot:()=>clone(state),refresh:()=>run(loadCatalog),destroy(){active=false;generation++;controller.abort();root.remove();}};
}
