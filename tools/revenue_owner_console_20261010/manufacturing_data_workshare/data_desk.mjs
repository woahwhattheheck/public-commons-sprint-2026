import * as core from './data_readiness.mjs';
import * as comparison from './data_comparison.mjs';

const clone=value=>JSON.parse(JSON.stringify(value));
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const LABELS={items:'Item master',bom:'Assembly BOM',inventory:'Inventory',purchaseOrders:'Open purchase orders'};
const KINDS=Object.keys(LABELS);
const uid=()=>globalThis.crypto?.randomUUID?.()||'desk-'+Date.now()+'-'+Math.random().toString(16).slice(2);
const now=()=>new Date().toISOString();
const bytes=value=>new TextEncoder().encode(value).length;
const MAX_FILE=16*1024*1024,MAX_SESSION=128*1024*1024;
const safeName=value=>String(value||'data').replace(/[^a-zA-Z0-9._-]+/g,'-').slice(0,120);
const stringify=value=>JSON.stringify(value,null,2)+'\n';
const definitions=kind=>core.FIELD_DEFINITIONS[kind];
const fieldName=field=>typeof field==='string'?field:field.name||field.key||field.field;
const fieldLabel=field=>typeof field==='string'?field:field.label||fieldName(field);
const table=(headers,rows)=>'<div class="table-wrap"><table><thead><tr>'+headers.map(x=>'<th>'+esc(x)+'</th>').join('')+'</tr></thead><tbody>'+rows.map(row=>'<tr>'+row.map(x=>'<td>'+esc(typeof x==='object'?JSON.stringify(x):x)+'</td>').join('')+'</tr>').join('')+'</tbody></table></div>';
function saveFile(name,body,type='application/json'){
 const blob=new Blob([body],{type}),url=URL.createObjectURL(blob),a=document.createElement('a');
 a.href=url;a.download=safeName(name);a.style.display='none';document.body.append(a);
 try{a.click();}finally{a.remove();setTimeout(()=>URL.revokeObjectURL(url),30000);}
}
async function readUTF8File(file,limit){
 const raw=await file.arrayBuffer();
 if(raw.byteLength>limit)throw Error('The complete file exceeds the supported size.');
 try{return new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(raw);}
 catch{throw Error('The source is not valid UTF-8. Export the original system file as UTF-8 and retain the original encoding separately. Current work remains selected.');}
}
function fieldRows(values){return Array.isArray(values)?values:Object.values(values||{});}

const COMPARISON_REVIEW_STATES=core.DISPOSITION_STATUSES;
const COMPARISON_FILTER_STATUSES=['all','added','missing','changed','ambiguous'];
function comparisonWorkspace(raw){
 const value=JSON.parse(raw.replace(/^\uFEFF/,''));
 const workspace=value?.schema==='manufacturing-data-desk.v1'?value.current?.workspace:value?.workspace||value;
 return core.importWorkspace(stringify(workspace));
}
function emptyComparison(){return {schema:'manufacturing-data-desk-comparison.v1',records:[],baselineId:'',targetId:'CURRENT',query:'',kind:'all',status:'all',reviewDrafts:{},reviews:{},reviewHistory:[]};}
function validateComparison(input){
 if(input===undefined)return emptyComparison();
 const value=clone(input),map=x=>x&&typeof x==='object'&&!Array.isArray(x);
 // Earlier editions offered this filter although unchanged identities are summary counts.
 if(map(value)&&value.status==='unchanged')value.status='all';
 if(!map(value)||value.schema!=='manufacturing-data-desk-comparison.v1'||!Array.isArray(value.records)||typeof value.baselineId!=='string'||typeof value.targetId!=='string'||typeof value.query!=='string'||!['all',...KINDS].includes(value.kind)||!COMPARISON_FILTER_STATUSES.includes(value.status)||!map(value.reviewDrafts)||!map(value.reviews)||!Array.isArray(value.reviewHistory))throw Error('The saved comparison selection or editor is incomplete.');
 const ids=new Set();
 for(const record of value.records){
  if(!record||typeof record.id!=='string'||!record.id||record.id==='CURRENT'||ids.has(record.id)||typeof record.name!=='string'||typeof record.at!=='string'||!Number.isFinite(Date.parse(record.at))||typeof record.raw!=='string'||bytes(record.raw)>MAX_SESSION||record.sha256!==core.sha256(record.raw))throw Error('A retained comparison edition is incomplete or its original bytes changed.');
  ids.add(record.id);const workspace=comparisonWorkspace(record.raw);
  if(record.workspaceId!==workspace.id||record.revision!==workspace.revision||record.label!==workspace.label||record.workspaceSha256!==core.sha256(core.exportWorkspace(workspace)))throw Error('The comparison edition identity differs from its exact original file.');
 }
 if(value.baselineId&&!ids.has(value.baselineId)||value.targetId!=='CURRENT'&&!ids.has(value.targetId))throw Error('A selected comparison source is absent.');
 const check=(id,row,recorded=false)=>{if(typeof id!=='string'||!id||!map(row)||!COMPARISON_REVIEW_STATES.includes(row.status)||typeof row.note!=='string'||recorded&&(typeof row.comparisonId!=='string'||!row.comparisonId||typeof row.actor!=='string'||typeof row.at!=='string'||!Number.isFinite(Date.parse(row.at))))throw Error('A saved comparison review is incomplete.');};
 for(const [id,row] of Object.entries(value.reviewDrafts))check(id,row);
 for(const [id,row] of Object.entries(value.reviews))check(id,row,true);
 for(const row of value.reviewHistory)check(row?.differenceId,row,true);
 return value;
}

function validateDesk(value){
 if(!value||value.schema!=='manufacturing-data-desk.v1'||!Array.isArray(value.history)||!Array.isArray(value.incoming))throw Error('Choose a complete Manufacturing Data Desk working file.');
 const verify=s=>{
  if(!s||!s.workspace||!Array.isArray(s.pending)||typeof s.unitText!=='string'||typeof s.actor!=='string'||typeof s.notes!=='string'||!s.dispositionDrafts||typeof s.dispositionDrafts!=='object'||Array.isArray(s.dispositionDrafts))throw Error('The saved desk does not contain its complete editor state.');
  const workspace=core.importWorkspace(stringify(s.workspace));
  if(typeof s.issueQuery!=='string'||!['all',...core.DISPOSITION_STATUSES].includes(s.issueStatus)||!KINDS.includes(s.tableKind)||typeof s.selectedPending!=='string')throw Error('The retained desk filters or selected table are incomplete.');
  for(const draft of Object.values(s.dispositionDrafts))if(!draft||typeof draft!=='object'||Array.isArray(draft)||!core.DISPOSITION_STATUSES.includes(draft.status)||typeof draft.note!=='string')throw Error('A saved decision editor is incomplete.');
  const pendingIds=new Set();
  for(const p of s.pending){
   if(!p||typeof p.id!=='string'||!KINDS.includes(p.kind)||typeof p.name!=='string'||typeof p.csv!=='string'||!p.columns||typeof p.columns!=='object'||Array.isArray(p.columns))throw Error('An incoming source is incomplete.');
   if(pendingIds.has(p.id))throw Error('Incoming source identities must be unique.');pendingIds.add(p.id);
   core.stageImport(workspace,p);
  }
  if(s.selectedPending&&!pendingIds.has(s.selectedPending))throw Error('The selected incoming source is absent.');
  return {...clone(s),workspace,comparison:validateComparison(s.comparison)};
 };
 const result={...clone(value),current:verify(value.current)};
 for(const kind of ['history','incoming']){
  const ids=new Set();
  result[kind]=value[kind].map(row=>{if(!row||typeof row.id!=='string'||ids.has(row.id)||typeof row.reason!=='string')throw Error('A retained desk edition has an invalid identity.');ids.add(row.id);return {...clone(row),state:verify(row.state)};});
 }
 return result;
}
export function mountDataReadinessDesk(root,config={}){
 if(!root)throw Error('Choose the data desk container.');
 let alive=true,epoch=0,busy=false,notice='',storageWarning='',issuePage=0,tablePage=0;
 let analyzedWorkspace=null,analyzedValue=null,previewCache=null,persistTimer=null,comparisonCache=null,comparisonPage=0;
 const comparisonWorkspaceCache=new WeakMap();
 const empty=()=>({workspace:core.createWorkspace({id:config.workspaceId||uid(),label:config.title||'Manufacturing data preparation',at:now()}),pending:[],unitText:'[]',actor:'',notes:'',dispositionDrafts:{},issueQuery:'',issueStatus:'all',tableKind:'items',selectedPending:'',comparison:emptyComparison()});
 let desk={schema:'manufacturing-data-desk.v1',current:empty(),history:[],incoming:[]};
 const storageKey=config.storageKey||'manufacturing-data-desk:'+(config.workspaceId||'default');
 let storage=config.storage;
 if(storage===undefined){try{storage=globalThis.localStorage;}catch(error){storage=null;storageWarning='Browser storage is unavailable. Download the working file to retain all edits.';}}
 const $=id=>root.querySelector('#'+id);
 let retainedBrowserSource=null;try{const saved=storage?.getItem(storageKey);if(saved){retainedBrowserSource=saved;desk=validateDesk(JSON.parse(saved));}}catch(error){desk.rejectedBrowserSource=retainedBrowserSource;storageWarning='The browser copy could not be opened. The original copy remains in browser storage. Open a saved working file, or continue this new desk and save it separately. '+error.message;}
 const current=()=>desk.current;
 const metadata=()=>({requestId:uid(),expectedRevision:current().workspace.revision,actor:current().actor.trim()||'Operator',at:now()});
 function persist(){try{storage?.setItem(storageKey,JSON.stringify(desk));storageWarning=storage?'':'This browser has no storage. Download the complete working file to retain your edits.';}catch(error){storageWarning='Browser storage did not retain the latest edits. The complete work remains open; download the working file now. '+error.message;}}
 function flushPersist(){if(persistTimer!==null){clearTimeout(persistTimer);persistTimer=null;}persist();const target=$('desk-storage');if(target){target.hidden=!storageWarning;target.textContent=storageWarning;}}
 function changed(deferred=false){if(deferred){if(persistTimer!==null)clearTimeout(persistTimer);persistTimer=setTimeout(()=>{persistTimer=null;if(alive)flushPersist();},250);}else flushPersist();}
 function status(text,error=false){notice=text;const el=$('desk-status');if(el){el.textContent=text;el.className=error?'error':'';}}
 async function action(task){
  if(!alive||busy)return;busy=true;const token=epoch;renderBusy();
  try{await task(()=>alive&&epoch===token);}catch(error){if(alive&&epoch===token)status(error.message||String(error),true);}
  finally{if(alive){busy=false;render();}}
 }
 function renderBusy(){root.querySelectorAll('[data-work-action]').forEach(el=>el.disabled=busy);}
 function setWorkspace(workspace,message){current().workspace=workspace;current().selectedPending='';issuePage=0;tablePage=0;changed();status(message);}
 function retainCurrent(reason){desk.history.push({id:uid(),at:now(),reason,state:clone(current())});}
 function sourcePreview(p){const workspace=current().workspace,mapping=JSON.stringify(p.columns);if(previewCache?.source===p&&previewCache.workspace===workspace&&previewCache.mapping===mapping)return previewCache.value;const value=core.stageImport(workspace,{id:p.id,kind:p.kind,name:p.name,csv:p.csv,delimiter:p.delimiter,columns:p.columns,at:p.at});previewCache={source:p,workspace,mapping,value};return value;}
 function report(){if(analyzedWorkspace!==current().workspace){analyzedWorkspace=current().workspace;analyzedValue=core.analyze(analyzedWorkspace);}return analyzedValue;}
 function filteredIssues(value){const query=current().issueQuery.toLowerCase();return value.issues.filter(issue=>(current().issueStatus==='all'||(issue.disposition?.status||'open')===current().issueStatus)&&(!query||JSON.stringify(issue).toLowerCase().includes(query)));}
 function summary(value){
  const counts=value.counts||{};
  return '<div class="metrics">'+KINDS.map(kind=>'<div class="metric"><strong>'+fieldRows(value.tables[kind]).length.toLocaleString()+'</strong>'+esc(LABELS[kind])+' rows</div>').join('')+'<div class="metric"><strong>'+value.issues.length.toLocaleString()+'</strong>Current exceptions</div></div><p class="muted">Workspace revision '+esc(current().workspace.revision)+' · '+esc(typeof value.readiness==='string'?value.readiness:(value.readiness.status||'').replace(/_/g,' ')+' · '+(value.readiness.note||''))+'</p>';
 }
 function renderPending(){
  const selected=current().pending.find(p=>p.id===current().selectedPending)||current().pending.at(-1);
  let html='<h2>Incoming source files</h2><p>Choose the source family and import an original CSV. Review its column mapping before selecting it as the current edition. Earlier files remain available.</p><div class="grid"><label>Source family<select id="desk-kind">'+KINDS.map(k=>'<option value="'+k+'">'+LABELS[k]+'</option>').join('')+'</select></label><label>CSV separator<select id="desk-delimiter"><option value=",">Comma</option><option value=";">Semicolon</option><option value="\t">Tab</option></select></label><label>Original CSV<input id="desk-csv" type="file" accept=".csv,.tsv,text/csv,text/tab-separated-values" data-work-action></label></div><div class="toolbar"><button type="button" data-action="template" data-work-action>Download selected blank template</button></div>';
  if(!selected)return html+'<p class="muted">No incoming files. The blank templates contain headers only.</p>';
  html+='<label>Retained incoming file<select id="desk-pending">'+current().pending.map(p=>'<option value="'+esc(p.id)+'" '+(p.id===selected.id?'selected':'')+'>'+esc(LABELS[p.kind]+' · '+p.name)+'</option>').join('')+'</select></label>';
  let preview;
  try{preview=sourcePreview(selected);}catch(error){return html+'<p class="error">'+esc(error.message)+'</p>';}
  html+='<p><strong>'+esc(selected.name)+'</strong> · '+esc(LABELS[selected.kind])+' · '+bytes(selected.csv).toLocaleString()+' original bytes</p><div class="grid">';
  for(const field of definitions(selected.kind)){
   const name=fieldName(field);
   html+='<label>'+esc(fieldLabel(field))+(field.required?' *':'')+'<select data-map="'+esc(name)+'" data-source="'+esc(selected.id)+'"><option value="">Unmapped</option>'+(['revision','parentRevision','componentRevision'].includes(name)?'<option value="__BLANK_REVISION__" '+(selected.columns[name]?.constant===''?'selected':'')+'>Explicit blank revision (no source column)</option>':'')+preview.headers.map(header=>'<option value="'+esc('column:'+header)+'" '+(selected.columns[name]===header?'selected':'')+'>'+esc(header)+'</option>').join('')+'</select></label>';
  }
  html+='</div><p class="muted">Column matching is an operator choice. The raw CSV is retained unchanged.</p>';
  if(preview.issues?.length)html+='<p>'+preview.issues.length+' mapping/format issues; showing the first 50. The complete analysis is retained.</p>'+table(['Issue','Action'],preview.issues.slice(0,50).map(x=>[x.message,x.action]));
  const rows=fieldRows(preview.canonicalRows||preview.rows);
  html+='<details><summary>Preview first '+Math.min(10,rows.length)+' of '+rows.length+' rows</summary>'+table(['Row'],rows.slice(0,10).map(row=>[row]))+'</details><div class="toolbar"><button type="button" class="primary" data-action="adopt" data-source="'+esc(selected.id)+'" data-work-action>Select this source edition</button><button type="button" data-action="pending-original" data-source="'+esc(selected.id)+'" data-work-action>Download original CSV</button></div>';
  return html;
 }
 function renderIssues(value){
  const all=filteredIssues(value);issuePage=Math.min(issuePage,Math.max(0,Math.ceil(all.length/30)-1));
  const selected=all.slice(issuePage*30,(issuePage+1)*30),statuses=core.DISPOSITION_STATUSES||['open','accepted','resolved'];
  const statusList=Array.isArray(statuses)?statuses:Object.keys(statuses);
  let html='<h2>Exceptions and decisions</h2><div class="grid"><label>Find source, item or exception<input id="desk-issue-query" value="'+esc(current().issueQuery)+'"></label><label>Decision state<select id="desk-issue-status"><option value="all">All decisions</option>'+statusList.map(x=>'<option value="'+esc(x)+'" '+(current().issueStatus===x?'selected':'')+'>'+esc(x)+'</option>').join('')+'</select></label></div><p>'+all.length+' matching exceptions · showing '+(all.length?issuePage*30+1:0)+'–'+Math.min((issuePage+1)*30,all.length)+'</p>';
  if(!selected.length)html+='<p class="muted">No matching exceptions. Review the source coverage and the report before using exported data.</p>';
  for(const issue of selected){
   const draft=current().dispositionDrafts[issue.id]||{status:issue.disposition?.status||'open',note:issue.disposition?.note||''};
   html+='<details data-issue="'+esc(issue.id)+'"><summary>'+esc(issue.severity+' · '+issue.code+' · '+issue.message)+'</summary><p>'+esc(issue.action)+'</p><pre>'+esc(JSON.stringify(issue.rows,null,2))+'</pre><div class="grid"><label>Decision<select data-decision-status="'+esc(issue.id)+'">'+statusList.map(x=>'<option value="'+esc(x)+'" '+(draft.status===x?'selected':'')+'>'+esc(x)+'</option>').join('')+'</select></label><label>Decision / correction note<textarea data-decision-note="'+esc(issue.id)+'">'+esc(draft.note)+'</textarea></label></div><button type="button" data-action="decision" data-issue="'+esc(issue.id)+'" data-work-action>Record this decision</button></details>';
  }
  return html+'<div class="toolbar"><button type="button" data-action="issues-prev" '+(!issuePage?'disabled':'')+'>Previous exceptions</button><button type="button" data-action="issues-next" '+((issuePage+1)*30>=all.length?'disabled':'')+'>Next exceptions</button><button type="button" data-action="exceptions" data-work-action>Download complete exceptions CSV</button></div>';
 }
 function renderTables(value){
  const kind=current().tableKind,rows=fieldRows(value.tables[kind]);
  tablePage=Math.min(tablePage,Math.max(0,Math.ceil(rows.length/40)-1));
  const keys=['sourceRow',...definitions(kind).map(fieldName),...new Set(rows.flatMap(x=>Object.keys(x.derived||{})))];
  return '<h2>Canonical source tables</h2><label>Table<select id="desk-table-kind">'+KINDS.map(k=>'<option value="'+k+'" '+(kind===k?'selected':'')+'>'+LABELS[k]+'</option>').join('')+'</select></label><p>'+rows.length+' rows · showing '+(rows.length?tablePage*40+1:0)+'–'+Math.min((tablePage+1)*40,rows.length)+'</p>'+table(keys,rows.slice(tablePage*40,(tablePage+1)*40).map(row=>keys.map(k=>k==='sourceRow'?row.ref?.row:row.values?.[k]??row.derived?.[k]??'')))+'<div class="toolbar"><button data-action="table-prev" '+(!tablePage?'disabled':'')+'>Previous rows</button><button data-action="table-next" '+((tablePage+1)*40>=rows.length?'disabled':'')+'>Next rows</button><button data-action="table-json" data-work-action>Download complete table JSON</button>'+(core.exportCanonicalCSV?'<button data-action="table-csv" data-work-action>Download complete table CSV</button>':'')+'</div>';
 }
 function retainedSources(value){return fieldRows(current().workspace.imports||current().workspace.sources||current().workspace.editions);}
 function renderHistory(value){
  const sources=retainedSources(value);
  return '<h2>Source editions and saved desks</h2><p>All retained original source editions are included in the complete working file. Open a prior desk as a new current selection while retaining the displaced desk.</p>'+table(['Selected source family','Original source'],Object.entries(value.activeSources||{}).map(([kind,item])=>[LABELS[kind]||kind,item]))+'<details><summary>All retained source editions</summary>'+sources.map(source=>'<div class="toolbar"><span>'+esc((source.kind?LABELS[source.kind]+' · ':'')+(source.name||source.id))+'</span><button data-action="source-original" data-source="'+esc(source.id)+'" data-work-action>Download original</button><button data-action="restage" data-source="'+esc(source.id)+'" data-work-action>Review mapping again</button></div>').join('')+'</details>'+['incoming','history'].map(kind=>'<h3>'+(kind==='incoming'?'Incoming working desks':'Earlier working desks')+'</h3>'+desk[kind].map(row=>'<div class="readonly"><p>'+esc(row.reason)+' · '+esc(row.at)+'</p><p>'+esc(row.state.workspace.label)+' · revision '+esc(row.state.workspace.revision)+'</p><button data-action="open-edition" data-edition="'+esc(row.id)+'" data-location="'+kind+'" data-work-action>Open this desk</button> <button data-action="edition-json" data-edition="'+esc(row.id)+'" data-location="'+kind+'" data-work-action>Download this complete desk</button></div>').join('')).join('');
 }

 function comparisonState(){return current().comparison;}
 function comparisonEdition(id){if(id==='CURRENT')return current().workspace;const row=comparisonState().records.find(row=>row.id===id);if(!row)return null;let workspace=comparisonWorkspaceCache.get(row);if(!workspace){workspace=comparisonWorkspace(row.raw);comparisonWorkspaceCache.set(row,workspace);}return workspace;}
 function compared(){
  const state=comparisonState(),left=comparisonEdition(state.baselineId),right=comparisonEdition(state.targetId);
  if(!left||!right)return null;
  if(comparisonCache?.left===left&&comparisonCache.right===right)return comparisonCache.value;
  const value=comparison.compareWorkspaces(left,right);comparisonCache={left,right,value};return value;
 }
 function comparisonReviewKey(id){return (compared()?.id||'unselected')+':'+id;}
 function comparisonExportOptions(){const value=compared(),ids=new Set(value?.differences.map(row=>row.id)||[]);return {reviews:comparisonState().reviewHistory.filter(row=>row.comparisonId===value?.id&&ids.has(row.differenceId)),reviewer:current().actor,notes:current().notes};}
 function comparisonRows(value){const state=comparisonState(),q=state.query.toLowerCase();return value.differences.filter(row=>(state.kind==='all'||row.kind===state.kind)&&(state.status==='all'||row.status===state.status)&&(!q||JSON.stringify(row).toLowerCase().includes(q)));}
 function retainComparison(raw,name){
  const state=comparisonState(),workspace=comparisonWorkspace(raw),digest=core.sha256(raw);
  const existing=state.records.find(row=>row.sha256===digest&&row.raw===raw);
  if(existing){status('This complete comparison edition is already retained. Choose it in the source selectors.');return existing;}
  const record={id:uid(),name,at:now(),raw,sha256:digest,workspaceId:workspace.id,label:workspace.label,revision:workspace.revision,workspaceSha256:core.sha256(core.exportWorkspace(workspace))};
  comparisonWorkspaceCache.set(record,workspace);
  state.records.push(record);
  if(!state.baselineId)state.baselineId=record.id;
  changed();status('Complete comparison edition retained beside the current desk. Choose the baseline and compared edition explicitly.');
  return record;
 }
 function renderComparison(){
  const state=comparisonState(),value=compared(),options=selected=>state.records.map(row=>'<option value="'+esc(row.id)+'" '+(selected===row.id?'selected':'')+'>'+esc(row.name+' · revision '+row.revision)+'</option>').join('');
  let html='<h2>Compare source and returned editions</h2><p>Retain the agreed baseline and compare it with a mapped successor or returned export. Every edition keeps its complete original source. Select the same entity, scope and cutover basis before interpreting differences.</p><div class="toolbar"><button data-action="comparison-retain" data-work-action>Retain current edition</button><label>Open an edition for comparison<input id="desk-comparison-open" type="file" accept=".json,application/json" data-work-action></label></div><div class="grid"><label>Baseline edition<select id="desk-comparison-baseline"><option value="">Choose retained baseline</option>'+options(state.baselineId)+'</select></label><label>Compared edition<select id="desk-comparison-target"><option value="CURRENT" '+(state.targetId==='CURRENT'?'selected':'')+'>Current working desk</option>'+options(state.targetId)+'</select></label></div>';
  if(!value)return html+'<p class="muted">Retain the current source or open an existing complete working/data file, then choose a baseline. Importing an edition leaves the working desk selected.</p>';
  const rows=comparisonRows(value);comparisonPage=Math.min(comparisonPage,Math.max(0,Math.ceil(rows.length/30)-1));
  html+='<p><strong>'+esc(String(value.readiness?.status||value.readiness||'').replace(/_/g,' '))+'</strong> · '+value.differences.length.toLocaleString()+' total differences · '+(value.issues?.length||0).toLocaleString()+' source/comparison issues</p>';
  html+='<div class="grid"><label>Find identity or changed field<input id="desk-comparison-query" value="'+esc(state.query)+'"></label><label>Source family<select id="desk-comparison-kind">'+['all',...KINDS].map(k=>'<option value="'+k+'" '+(state.kind===k?'selected':'')+'>'+esc(k==='all'?'All families':LABELS[k])+'</option>').join('')+'</select></label><label>Difference<select id="desk-comparison-status">'+COMPARISON_FILTER_STATUSES.map(k=>'<option value="'+k+'" '+(state.status===k?'selected':'')+'>'+esc(k==='all'?'All differences':k)+'</option>').join('')+'</select></label></div>';
  if(value.issues?.length)html+='<details><summary>Source and comparison issues ('+value.issues.length.toLocaleString()+')</summary>'+table(['Family','Issue','Action'],value.issues.slice(0,50).map(row=>[LABELS[row.kind]||row.kind||'',row.message||row.code,row.action||'']))+'<p class="muted">Showing the first 50 issues. Complete JSON and HTML reports contain the full result.</p></details>';
  html+='<p>'+rows.length.toLocaleString()+' matching differences · showing '+(rows.length?comparisonPage*30+1:0)+'–'+Math.min((comparisonPage+1)*30,rows.length)+'</p>';
  for(const row of rows.slice(comparisonPage*30,(comparisonPage+1)*30)){
   const key=comparisonReviewKey(row.id),review=state.reviewDrafts[key]||state.reviews[key]||{status:'open',note:''};
   const fields=Array.isArray(row.fields)?row.fields:[];
   html+='<details data-comparison-difference="'+esc(row.id)+'"><summary>'+esc(LABELS[row.kind]||row.kind)+' · '+esc(row.status)+' · '+esc(typeof row.identity==='string'?row.identity:JSON.stringify(row.identity))+'</summary>'+table(['Field','Baseline','Compared','Exact quantity difference'],fields.map(field=>[field.field,field.before??'',field.after??'',field.delta??'']))+'<p class="muted">Baseline rows: '+esc(JSON.stringify((row.beforeRows||[]).slice(0,10).map(r=>r.ref)))+' · Compared rows: '+esc(JSON.stringify((row.afterRows||[]).slice(0,10).map(r=>r.ref)))+'</p><div class="grid"><label>Review state<select data-comparison-review-status="'+esc(row.id)+'">'+COMPARISON_REVIEW_STATES.map(s=>'<option value="'+s+'" '+(review.status===s?'selected':'')+'>'+esc(s)+'</option>').join('')+'</select></label><label>Disposition and owner note<textarea data-comparison-review-note="'+esc(row.id)+'">'+esc(review.note)+'</textarea></label></div><button data-action="comparison-review" data-difference="'+esc(row.id)+'" data-work-action>Record comparison review</button></details>';
  }
  html+='<p class="muted">A review note records a decision; it does not remove the underlying source difference. Different units and ambiguous identities need an explicit business decision.</p><div class="toolbar"><button data-action="comparison-prev" '+(!comparisonPage?'disabled':'')+'>Previous differences</button><button data-action="comparison-next" '+((comparisonPage+1)*30>=rows.length?'disabled':'')+'>Next differences</button><button data-action="comparison-json" data-work-action>Download complete comparison JSON</button><button data-action="comparison-csv" data-work-action>Download complete differences CSV</button><button data-action="comparison-report" data-work-action>Download full comparison report</button></div>';
  return html+'<details><summary>Retained comparison originals ('+state.records.length+')</summary>'+state.records.map(row=>'<div class="toolbar"><span>'+esc(row.name)+' · '+bytes(row.raw).toLocaleString()+' bytes</span><button data-action="comparison-original" data-edition="'+esc(row.id)+'" data-work-action>Download exact original</button></div>').join('')+'</details>';
 }

 function render(){
  if(!alive)return;
  const value=report();
  root.innerHTML='<header><p class="muted">TOKENJUNKIE LABS · MANUFACTURING DATA PREPARATION</p><h1>'+esc(current().workspace.label||config.title)+'</h1><p>'+esc(config.introduction||'Review item, assembly, inventory and purchase-order sources before an implementation handover.')+'</p></header><div id="desk-status" role="status">'+esc(notice)+'</div><p id="desk-storage" class="warn" '+(!storageWarning?'hidden':'')+'>'+esc(storageWarning)+'</p><div class="toolbar"><button data-action="save" class="primary" data-work-action>Download complete working file</button><label class="no-print">Open complete working file<input id="desk-open" type="file" accept=".json,application/json" data-work-action></label><button data-action="report" data-work-action>Download full readiness report</button><button data-action="handover" data-work-action>Download data handover JSON</button></div><section class="panel">'+summary(value)+'<div class="grid"><label>Reviewed by<input id="desk-actor" value="'+esc(current().actor)+'" placeholder="Name or team"></label><label>Working notes<textarea id="desk-notes">'+esc(current().notes)+'</textarea></label></div></section><section class="panel">'+renderPending()+'</section><section class="panel"><h2>Explicit unit mappings</h2><p class="muted">Use approved conversions only. A missing conversion remains an exception. Unit decisions are retained with their review.</p><details><summary>Unit mapping format</summary><pre id="desk-unit-help">'+esc(config.unitHelp||'Enter the documented unit mapping array. Leave [] when no conversion is approved.')+'</pre></details><label>Complete approved mapping array<textarea id="desk-units" spellcheck="false">'+esc(current().unitText)+'</textarea></label><button data-action="units" data-work-action>Apply these unit mappings</button></section><section class="panel">'+renderIssues(value)+'</section><section class="panel">'+renderTables(value)+'</section><section class="panel">'+renderComparison()+'</section><section class="panel">'+renderHistory(value)+'</section><footer><p class="muted">Quantities and decisions come from the retained source files. Review target-system rules and physical stock with the implementation lead. This desk prepares files; it does not write to an ERP or change inventory.</p></footer>';
  renderBusy();
 }
 function getSource(id){return retainedSources(report()).find(x=>x.id===id);}
 root.addEventListener('input',event=>{
  const target=event.target;if(!alive)return;
  if(target.id==='desk-actor')current().actor=target.value;
  else if(target.id==='desk-notes')current().notes=target.value;
  else if(target.id==='desk-units')current().unitText=target.value;
  else if(target.dataset.comparisonReviewNote){const id=comparisonReviewKey(target.dataset.comparisonReviewNote),state=comparisonState();state.reviewDrafts[id]??={status:state.reviews[id]?.status||'open',note:state.reviews[id]?.note||''};state.reviewDrafts[id].note=target.value;}
  else if(target.dataset.decisionNote){const id=target.dataset.decisionNote,issue=report().issues.find(x=>x.id===id);current().dispositionDrafts[id]??={status:issue?.disposition?.status||'open',note:''};current().dispositionDrafts[id].note=target.value;}
  else return;changed(true);
 });
 root.addEventListener('change',event=>{
  if(!alive)return;
  const target=event.target;
  if(target.id==='desk-comparison-open')action(async isCurrent=>{
   const file=target.files?.[0];if(!file)return;if(file.size>MAX_SESSION)throw Error('Choose a complete comparison edition no larger than 128 MiB.');
   const raw=await readUTF8File(file,MAX_SESSION);if(!isCurrent())return;retainComparison(raw,file.name);
  });
  else if(target.id==='desk-csv')action(async isCurrent=>{
   const file=target.files?.[0];if(!file)return;if(file.size>MAX_FILE)throw Error('Choose a CSV no larger than 16 MiB.');
   const kind=$('desk-kind').value,delimiter=$('desk-delimiter').value,csv=await readUTF8File(file,MAX_FILE);
   if(!isCurrent())return;if(bytes(csv)>MAX_FILE)throw Error('The decoded CSV exceeds 16 MiB.');
   const parsed=core.inspectCSV(csv,{delimiter}),columns={};
   for(const field of definitions(kind)){const key=fieldName(field);if(parsed.headers.includes(key))columns[key]=key;}
   const incoming={id:uid(),kind,name:file.name,csv,delimiter,columns,at:now()};
   current().pending.push(incoming);current().selectedPending=incoming.id;changed();status('Original CSV retained. Review its mapping and select the source edition.');
  });
  else if(target.id==='desk-open')action(async isCurrent=>{
   const file=target.files?.[0];if(!file)return;if(file.size>MAX_SESSION)throw Error('Choose a complete working file no larger than 128 MiB.');
   const raw=await readUTF8File(file,MAX_SESSION);if(!isCurrent())return;if(bytes(raw)>MAX_SESSION)throw Error('The decoded working file exceeds 128 MiB.');
   const incoming=validateDesk(JSON.parse(raw.replace(/^\uFEFF/,''))),at=now();
   const entries=[{id:uid(),at,reason:'Opened '+file.name,state:incoming.current},...incoming.incoming,...incoming.history];
   for(const row of entries)desk.incoming.push({...row,id:uid(),reason:'From '+file.name+': '+row.reason});
   changed();status('The complete incoming desk is retained below. Choose Open this desk to adopt it; current work stays selected.');
  });
  else if(target.id==='desk-comparison-baseline'||target.id==='desk-comparison-target'){comparisonState()[target.id.endsWith('baseline')?'baselineId':'targetId']=target.value;comparisonPage=0;changed();render();}
  else if(target.id==='desk-comparison-query'||target.id==='desk-comparison-kind'||target.id==='desk-comparison-status'){comparisonState()[target.id.slice('desk-comparison-'.length)]=target.value;comparisonPage=0;changed();render();}
  else if(target.dataset.comparisonReviewStatus){const id=comparisonReviewKey(target.dataset.comparisonReviewStatus),state=comparisonState();state.reviewDrafts[id]??={status:'open',note:state.reviews[id]?.note||''};state.reviewDrafts[id].status=target.value;changed();}
  else if(target.dataset.map&&!busy){const p=current().pending.find(x=>x.id===target.dataset.source);if(p){p.columns[target.dataset.map]=target.value==='__BLANK_REVISION__'&&['revision','parentRevision','componentRevision'].includes(target.dataset.map)?{constant:''}:target.value.startsWith('column:')?target.value.slice(7):'';changed();render();}}
  else if(target.dataset.decisionStatus){const id=target.dataset.decisionStatus,issue=report().issues.find(x=>x.id===id);current().dispositionDrafts[id]??={status:'open',note:issue?.disposition?.note||''};current().dispositionDrafts[id].status=target.value;changed();}
  else if(target.id==='desk-pending'){current().selectedPending=target.value;changed();render();}
  else if(target.id==='desk-table-kind'){current().tableKind=target.value;tablePage=0;changed();render();}
  else if(target.id==='desk-issue-status'){current().issueStatus=target.value;issuePage=0;changed();render();}
  else if(target.id==='desk-issue-query'){current().issueQuery=target.value;issuePage=0;changed();render();}
 });
 root.addEventListener('click',event=>{
  const target=event.target.closest('[data-action]');if(!target||!root.contains(target)||target.disabled)return;
  const op=target.dataset.action;
  action(async()=>{
   if(op==='comparison-retain')retainComparison(core.exportWorkspace(current().workspace),current().workspace.label+' · revision '+current().workspace.revision);
   else if(op==='comparison-original'){const row=comparisonState().records.find(x=>x.id===target.dataset.edition);if(!row)throw Error('Choose a retained comparison source.');saveFile(row.name.endsWith('.json')?row.name:row.name+'.json',row.raw);}
   else if(op==='comparison-prev')comparisonPage=Math.max(0,comparisonPage-1);
   else if(op==='comparison-next')comparisonPage++;
   else if(op==='comparison-review'){
    const value=compared(),row=value?.differences.find(x=>x.id===target.dataset.difference);if(!row)throw Error('Choose a difference from the current source pair.');
    const state=comparisonState(),key=comparisonReviewKey(row.id),draft=state.reviewDrafts[key]||state.reviews[key]||{status:'open',note:''};
    const review={comparisonId:value.id,differenceId:row.id,status:draft.status,note:draft.note,actor:current().actor.trim()||'Operator',at:now()};
    comparison.exportComparisonJSON(value,{reviews:[review]});
    state.reviews[key]=review;state.reviewHistory.push(review);changed();status('Comparison review retained with the exact source pair. The underlying difference remains in the report.');
   }else if(op==='comparison-json'||op==='comparison-csv'||op==='comparison-report'){
    const value=compared();if(!value)throw Error('Choose the complete source pair first.');
    const options=comparisonExportOptions();
    if(op==='comparison-json')saveFile('source-comparison.json',comparison.exportComparisonJSON(value,options));
    else if(op==='comparison-csv')saveFile('source-comparison.csv',comparison.exportComparisonCSV(value,options),'text/csv;charset=utf-8');
    else saveFile('source-comparison.html',comparison.reportHTML(value,options),'text/html;charset=utf-8');
   }else if(op==='template')saveFile($('desk-kind').value+'-template.csv',core.templateCSV($('desk-kind').value),'text/csv;charset=utf-8');
   else if(op==='save')saveFile(safeName(current().workspace.label)+'-working.json',stringify(desk));
   else if(op==='report')saveFile('readiness-report.html',core.reportHTML(current().workspace),'text/html;charset=utf-8');
   else if(op==='handover')saveFile('manufacturing-data-handover.json',stringify({schema:'manufacturing-data-handover.v1',createdAt:now(),workspace:current().workspace,analysis:report(),reviewer:current().actor,notes:current().notes}));
   else if(op==='adopt'){
    const p=current().pending.find(x=>x.id===target.dataset.source);if(!p)throw Error('Choose an incoming source.');
    const next=core.adoptImport(current().workspace,sourcePreview(p),metadata());current().pending=current().pending.filter(x=>x.id!==p.id);setWorkspace(next,'Selected source edition retained. Review its current exceptions below.');
   }else if(op==='pending-original'){
    const p=current().pending.find(x=>x.id===target.dataset.source);if(p)saveFile(p.name,p.csv,'text/csv;charset=utf-8');
   }else if(op==='source-original'||op==='restage'){
    const source=getSource(target.dataset.source);if(!source)throw Error('The original source edition is unavailable.');
    if(op==='source-original')saveFile(source.name,source.csv,'text/csv;charset=utf-8');
    else {const p={...clone(source),id:uid(),at:now()};current().pending.push(p);current().selectedPending=p.id;changed();status('Original source copied into the mapping editor. Its current selection remains unchanged.');}
   }else if(op==='units')setWorkspace(core.setUnitMappings(current().workspace,{mappings:JSON.parse(current().unitText),...metadata()}),'Approved unit mappings retained. Exceptions recalculated from original values.');
   else if(op==='decision'){
    const issue=report().issues.find(x=>x.id===target.dataset.issue);if(!issue)throw Error('This exception is no longer current.');
    const d=current().dispositionDrafts[issue.id]||{status:issue.disposition?.status||'open',note:issue.disposition?.note||''};
    setWorkspace(core.recordDisposition(current().workspace,{issueId:issue.id,...d,...metadata()}),'Decision retained with the original exception.');
   }else if(op==='exceptions')saveFile('data-exceptions.csv',core.exportExceptionsCSV(current().workspace),'text/csv;charset=utf-8');
   else if(op==='table-json')saveFile(current().tableKind+'-canonical.json',stringify(report().tables[current().tableKind]));
   else if(op==='table-csv')saveFile(current().tableKind+'-canonical.csv',core.exportCanonicalCSV(current().workspace,current().tableKind),'text/csv;charset=utf-8');
   else if(op==='issues-prev')issuePage=Math.max(0,issuePage-1);
   else if(op==='issues-next')issuePage++;
   else if(op==='table-prev')tablePage=Math.max(0,tablePage-1);
   else if(op==='table-next')tablePage++;
   else if(op==='open-edition'||op==='edition-json'){
    const row=desk[target.dataset.location]?.find(x=>x.id===target.dataset.edition);if(!row)throw Error('Choose a retained desk edition.');
    if(op==='edition-json')saveFile('retained-working-desk.json',stringify({...desk,current:row.state}));
    else {retainCurrent('Prior desk before opening '+row.reason);desk.current=clone(row.state);if(target.dataset.location==='incoming')desk.incoming=desk.incoming.filter(x=>x.id!==row.id);epoch++;issuePage=0;tablePage=0;changed();status('Opened the selected desk. Its displaced predecessor remains in Earlier working desks.');}
   }
  });
 });
 const view=root.ownerDocument?.defaultView;
 const onPageHide=()=>{if(alive)flushPersist();};view?.addEventListener('pagehide',onPageHide);
 render();return {getState:()=>clone(desk),download:()=>saveFile('manufacturing-working.json',stringify(desk)),dispose(){if(persistTimer!==null)flushPersist();alive=false;epoch++;view?.removeEventListener('pagehide',onPageHide);root.replaceChildren();}};
}
