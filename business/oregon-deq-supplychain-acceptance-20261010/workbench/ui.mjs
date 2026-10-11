// MIT. Local material-trace operator. All changes use the retained revisioned API.
const $=selector=>document.querySelector(selector);
const E=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const words=value=>String(value??'').replaceAll('_',' ').replaceAll('-',' ');
const label=value=>words(value).replace(/^\w/,c=>c.toUpperCase());
const pretty=value=>typeof value==='object'?JSON.stringify(value,null,2):String(value??'');
const badge=(value,kind='')=>'<span class="badge '+E(kind)+'">'+E(words(value))+'</span>';
const button=(text,action,attrs='',secondary=true)=>'<button type="button" class="'+(secondary?'secondary':'')+'" data-action="'+E(action)+'" '+attrs+'>'+E(text)+'</button>';
const option=(value,text,selected)=>'<option value="'+E(value)+'"'+(selected?' selected':'')+'>'+E(text)+'</option>';
const table=(heads,rows)=>'<div class="table-wrap"><table><thead><tr>'+heads.map(h=>'<th scope="col">'+E(h)+'</th>').join('')+'</tr></thead><tbody>'+rows.map(row=>'<tr>'+row.map(c=>'<td>'+c+'</td>').join('')+'</tr>').join('')+'</tbody></table></div>';
const pager=(offset,total,size,action)=>'<div class="paging"><span class="muted">'+(total?Math.min(offset+1,total)+'–'+Math.min(offset+size,total):'0')+' of '+total+'</span><div class="actions">'+button('Previous',action,'data-offset="'+Math.max(0,offset-size)+'"'+(offset===0?' disabled':''))+button('Next',action,'data-offset="'+(offset+size)+'"'+(offset+size>=total?' disabled':''))+'</div></div>';
const state={tab:'overview',view:null,sourceId:'',sourceOffset:0,sourceSearch:'',sourceData:null,editRow:0,issueSearch:'',issueOffset:0,historyOffset:0,productId:'',nodeOffset:0,linkOffset:0,renderId:0,pending:null,busy:false};
let key=sessionStorage.getItem('trace.operator.key')||'',actor=sessionStorage.getItem('trace.operator.actor')||'';
const tabs=[['overview','Overview'],['sources','Sources & mapping'],['findings','Findings & review'],['exports','Handoff & exports'],['history','Edit history']];

function notice(text='',retry=false) {
  $('#notice').innerHTML=text?'<div class="notice">'+E(text)+(retry?' <button type="button" data-action="retry">Retry the retained edit</button>':'')+'</div>':'';
}
async function request(route,{body,raw=false}={}) {
  const response=await fetch(route,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+key,...(body?{'Content-Type':'application/json'}:{})},body:body?JSON.stringify(body):undefined,cache:'no-store'});
  if(!response.ok) {
    let message;try{const value=await response.json();message=value.error||value.message;}catch{}
    const error=new Error(message||'Request failed ('+response.status+')');error.status=response.status;throw error;
  }
  return raw?response:response.json();
}
function session() {
  $('#login').hidden=Boolean(state.view);$('#app').hidden=!state.view;
  $('#session-controls').innerHTML=state.view?'<div class="session"><label class="tight">Reviewer<input id="current-reviewer" value="'+E(actor)+'" maxlength="256" autocomplete="name"></label><span class="muted">Revision '+state.view.state.revision+'</span><div class="actions">'+button('Refresh','refresh')+button('Close','logout')+'</div></div>':'';
}
async function refresh(message='') {
  state.view=await request('/api/view?search='+encodeURIComponent(state.issueSearch)+'&issueOffset='+state.issueOffset);
  if(!state.view.state.imports.some(i=>i.id===state.sourceId)){state.sourceId=state.view.state.imports[0]?.id||'';state.sourceOffset=0;state.editRow=0;}
  session();await render();if(message)notice(message);else if(!state.pending)notice();
}
async function mutate(command,retained=null) {
  if(state.busy)return;
  if(state.pending && !retained){notice('An edit is awaiting its response. Retry that same edit to recover its result.',true);return;}
  actor=$('#current-reviewer')?.value.trim()||actor;
  if(!actor){notice('Enter the reviewer responsible for this change.');return;}
  sessionStorage.setItem('trace.operator.actor',actor);
  const operation=retained||{operationId:crypto.randomUUID(),expectedRevision:state.view.state.revision,actor,command};
  state.pending=operation;state.busy=true;$('#app').inert=true;
  notice('Saving the retained edit…');
  try {
    const result=await request('/api/command',{body:operation});
    state.pending=null;state.busy=false;$('#app').inert=false;
    await refresh('Saved revision '+result.revision+(result.replayed?' · recovered the original edit.':'.'));
  } catch(error) {
    state.busy=false;$('#app').inert=false;
    if(error.status){state.pending=null;if(error.status===409)await refresh();notice(error.message);}
    else notice('The response was interrupted. The original edit is retained here; retry it to obtain its saved result.',true);
  }
}
async function download(route) {
  const response=await request(route,{raw:true}),blob=await response.blob();
  const filename=/filename="([^"]+)"/.exec(response.headers.get('content-disposition')||'')?.[1]||'trace-download';
  const url=URL.createObjectURL(blob),anchor=document.createElement('a');anchor.href=url;anchor.download=filename;anchor.click();setTimeout(()=>URL.revokeObjectURL(url),30000);
}
function top() {
  const v=state.view;
  return '<nav aria-label="Workspace sections">'+tabs.map(([id,title])=>'<button type="button" data-tab="'+id+'"'+(state.tab===id?' aria-current="page"':'')+'>'+title+'</button>').join('')+'</nav><div class="toolbar"><div><h2>'+E(v.state.title)+'</h2><p class="muted">Review date '+E(v.state.asOf)+' · Evidence age '+v.state.maxAgeDays+' days · Revision '+v.state.revision+'</p></div></div><div id="section"></div>';
}
async function render() {
  if(!state.view)return;
  const ticket=++state.renderId;$('#app').innerHTML=top();const section=$('#section');
  if(state.tab==='overview') {
    section.innerHTML=overview();await loadTrace(ticket);
  } else if(state.tab==='sources') {
    section.innerHTML=sources();
    if(state.sourceId) {
      const data=await request('/api/rows?importId='+encodeURIComponent(state.sourceId)+'&offset='+state.sourceOffset+'&search='+encodeURIComponent(state.sourceSearch));
      if(ticket!==state.renderId)return;
      if(data.revision!==state.view.state.revision){await refresh('The workspace changed; the latest source rows are shown.');return;}
      state.sourceData=data;$('#source-detail').innerHTML=sourceDetail(data);
    }
  } else if(state.tab==='findings') section.innerHTML=findings();
  else if(state.tab==='exports') section.innerHTML=exportsView();
  else if(state.tab==='history') {
    const data=await request('/api/history?offset='+state.historyOffset);if(ticket!==state.renderId)return;
    section.innerHTML=history(data);
  }
}
function overview() {
  const r=state.view.report,s=r.summary,c=r.counts,metric=(n,t)=>'<div class="metric"><strong>'+E(n)+'</strong><span>'+E(t)+'</span></div>';
  return '<div class="metrics">'+[[s.products,'Products'],[s.facilities,'Facilities'],[s.links,'Material links'],[c.sourceRows,'Retained source rows'],[s.openIssues,'Open review findings']].map(([n,t])=>metric(n,t)).join('')+'</div>'+
  '<section class="panel"><div class="toolbar"><h3>Source reconciliation</h3>'+button('Open source mapping','tab-sources')+'</div>'+table(['Included','Contributed evidence','Excluded','Unmapped','Invalid','Conflicting'],[[c.included,c.contributed,c.excluded,c.unmapped,c.invalid,c.conflict].map(E)])+
  '<p class="form-note">Each imported row keeps its original file, row position and current disposition. Corrections and review notes are retained with the reviewer and revision.</p></section>'+
  '<section class="panel"><h3>Complete upstream coverage</h3>'+(r.branches.length?table(['Product','Upstream facilities','Upstream / all links','Disconnected links','Untraced endpoints','Cycles','Missing risk pairs'],r.branches.map(b=>[E(b.productId),E(b.upstreamNodeIds.length),E(b.upstreamLinkIds.length+' / '+b.allProductLinks),E(b.disconnectedLinks),E(b.untracedEndpoints.length),E(b.cyclicNodes.length),E(b.missingRiskPairs)])):'<div class="empty">Import products, facilities and material links to review their upstream coverage.</div>')+
  '<p class="form-note">The original selected-path audit is included alongside reconciliation of all product branches. Risk coverage follows each retained upstream facility.</p></section>'+
  '<section class="panel"><div class="toolbar"><h3>Product trace</h3><label class="tight">Product<select id="trace-product">'+option('','Choose a product',!state.productId)+r.products.map(p=>option(p.id,p.name+' · '+p.id,state.productId===p.id)).join('')+'</select></label></div><div id="trace-detail" class="muted">Choose a product to inspect its facilities and links.</div></section>'+
  '<section class="panel"><h3>Review settings</h3><form id="options-form"><div class="mapping-grid"><label>Workspace title<input name="title" value="'+E(state.view.state.title)+'" maxlength="256" required></label><label>Review instant (UTC)<input name="asOf" value="'+E(state.view.state.asOf)+'" placeholder="2026-10-11T12:00:00Z" required></label><label>Maximum evidence age in days<input name="maxAgeDays" type="number" min="1" max="7300" value="'+state.view.state.maxAgeDays+'" required></label></div><button>Save review settings</button><p class="form-note">A source or review-setting change marks earlier review notes as needing review again.</p></form></section>';
}
async function loadTrace(ticket=state.renderId) {
  if(!state.productId)return;
  const value=await request('/api/trace?productId='+encodeURIComponent(state.productId)+'&nodeOffset='+state.nodeOffset+'&linkOffset='+state.linkOffset);
  if(ticket!==state.renderId || !$('#trace-detail'))return;
  const upstream=new Set(value.branch.upstreamNodeIds),nodes=value.nodes,links=value.links;
  const b=value.branch,audit=state.view.report.audit?.products?.find(p=>p.productId===value.product.id);
  $('#trace-detail').innerHTML='<div class="actions">'+badge(b.cyclicNodes.length?'Cycle review required':'No upstream cycles')+badge(b.untracedEndpoints.length+' untraced endpoints')+badge(b.disconnectedLinks+' disconnected links')+'</div>'+
  (audit?'<p class="form-note">Selected-path audit: '+E(words(audit.pathStatus))+' · '+E(words(audit.acceptance))+' · '+E(audit.sourceToMarketEdges?.length||0)+' selected links.</p>':'')+
  diagram(nodes,links)+
  '<p class="form-note">Diagram shows up to 60 facilities from the displayed page. The tables and exports retain every facility and link.</p>'+
  '<h3>Facilities</h3>'+table(['ID','Name','Stage','Country','Latitude','Longitude','Reaches destination'],nodes.map(n=>[E(n.id),E(n.name),E(words(n.stage)),E(n.country),E(n.latitude),E(n.longitude),E(upstream.has(n.id)?'Yes':'Disconnected')]))+pager(value.nodeOffset,value.nodeTotal,500,'trace-nodes')+
  '<h3>Material links</h3>'+table(['ID','From','To','Evidence'],links.map(e=>[E(e.id),E(e.from),E(e.to),'<pre>'+E(pretty(e.evidence))+'</pre>']))+pager(value.linkOffset,value.linkTotal,1000,'trace-links');
}
function diagram(nodes,links) {
  if(!nodes.length)return'';
  const stages=['extraction','processing','manufacturing','distribution','oregon-market'],shown=nodes.slice(0,60),counts=Object.fromEntries(stages.map(x=>[x,0])),positions=new Map();
  for(const node of shown){const col=stages.indexOf(node.stage);if(col<0)continue;positions.set(node.id,{x:col*195+15,y:counts[node.stage]++*66+45});}
  const lanes=Math.max(...Object.values(counts))*66+65,height=Math.max(230,lanes+70);
  const edges=links.filter(e=>positions.has(e.from)&&positions.has(e.to)).map((e,index)=>{const a=positions.get(e.from),b=positions.get(e.to),lane=lanes+(index%6)*9;return '<path class="edge" marker-end="url(#trace-arrow)" d="M '+(a.x+166)+' '+(a.y+21)+' H '+(a.x+180)+' V '+lane+' H '+(b.x-8)+' V '+(b.y+21)+' H '+b.x+'"><title>'+E(e.id+': '+e.from+' → '+e.to)+'</title></path>';}).join('');
  return '<div class="diagram"><svg viewBox="0 0 985 '+height+'" role="img" aria-label="Facilities and links in the selected material trace"><defs><marker id="trace-arrow" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto"><path d="M 0 0 L 6 3 L 0 6 Z"></path></marker></defs>'+stages.map((s,i)=>'<text class="stage-label" x="'+(i*195+15)+'" y="24">'+E(label(s))+'</text>').join('')+edges+shown.map(n=>{const p=positions.get(n.id);return p?'<g><rect x="'+p.x+'" y="'+p.y+'" width="166" height="44" rx="2"></rect><text x="'+(p.x+8)+'" y="'+(p.y+17)+'">'+E(n.id.slice(0,23))+'</text><text x="'+(p.x+8)+'" y="'+(p.y+33)+'">'+E((n.name||label(n.stage)).slice(0,24))+'</text><title>'+E(n.id+' · '+(n.name||'')+' · '+n.stage)+'</title></g>':'';}).join('')+'</svg></div>';
}
function sources() {
  const imports=state.view.state.imports;
  return '<section class="panel"><h3>Import original source bytes</h3><form id="upload-form"><div class="mapping-grid"><label>Source type<select name="kind">'+[['products','Products'],['nodes','Facilities'],['links','Material links'],['risks','Risk assessments'],['evidence','Supporting evidence'],['graph','Original trace-evidence graph']].map(([v,t])=>option(v,t,false)).join('')+'</select></label><label>File format<select name="format">'+['csv','tsv','json'].map(v=>option(v,v.toUpperCase(),v==='csv')).join('')+'</select></label><label>Source file<input name="file" type="file" accept=".csv,.tsv,.json,text/csv,text/tab-separated-values,application/json" required></label></div><button>Retain source and open mapping</button><p class="form-note">CSV, TSV or JSON records; up to 16 MiB and 100,000 rows per source. Original bytes remain unchanged. Existing trace-evidence graphs retain their known schema mapping.</p></form></section>'+
  '<div class="split"><aside class="panel"><h3>Retained sources</h3><div class="source-list">'+(imports.length?imports.map(i=>'<button type="button" data-action="source" data-id="'+E(i.id)+'" class="'+(state.sourceId===i.id?'selected':'')+'">'+E(i.fileName)+(i.part?' · '+E(i.part):'')+'<small>'+E(label(i.kind))+' · '+i.rowCount+' rows · '+(i.enabled?'active':'disabled')+'</small></button>').join(''):'<p class="muted">Imported sources appear here.</p>')+'</div></aside><section id="source-detail" class="panel">'+(state.sourceId?'Opening retained source…':'<div class="empty">Choose a file to begin.</div>')+'</section></div>';
}
function enumRow(field,raw='',value='') {
  return '<div class="enum-row" data-enum-field="'+E(field)+'"><input aria-label="'+E(field)+' source value" class="enum-raw" value="'+E(raw)+'" placeholder="Original source value" maxlength="256"><select class="enum-value" aria-label="'+E(field)+' mapped value">'+option('','Keep source value',!value)+state.view.enums[field].map(v=>option(v,label(v),v===value)).join('')+'</select></div>';
}
function sourceDetail(data) {
  const item=data.import;
  const mappings='<form id="mapping-form"><div class="mapping-grid">'+data.fields.map(field=>'<label>'+E(label(field))+'<select data-map-field="'+E(field)+'">'+option('','Choose source column',!item.mapping[field])+item.columns.map(c=>option(c,c,item.mapping[field]===c)).join('')+'</select></label>').join('')+'</div><div class="actions">'+button('Use matching headings','suggest-mapping')+'<button>Save field mapping</button></div><details><summary>Translate source values to the trace vocabulary</summary><p class="form-note">Choose translations for the original source values. A row correction takes precedence.</p>'+data.fields.filter(f=>data.enums[f]).map(field=>'<section class="enum-section" data-enum-section="'+E(field)+'"><h3>'+E(label(field))+'</h3><div class="enum-rows">'+Object.entries(item.valueMaps[field]||{}).map(([raw,value])=>enumRow(field,raw,value)).join('')+enumRow(field)+'</div>'+button('Add value translation','add-enum','data-field="'+E(field)+'"')+'</section>').join('')+'</details></form>';
  const row=state.editRow?data.rows.find(r=>r.number===state.editRow):null;
  return '<div class="toolbar"><div><h3>'+E(item.fileName)+'</h3><p class="muted">'+E(label(item.kind))+' · '+item.rowCount+' original rows'+(item.part?' · graph section '+E(item.part):'')+'</p></div>'+button('Download original','source-download')+'</div><details><summary>Source identity</summary><p class="mono">'+E(item.sha256)+'</p><p class="muted">'+E(item.id)+'</p></details><h3>Column mapping</h3>'+mappings+
  '<details><summary>'+(item.enabled?'Disable this source':'Enable this source')+'</summary><form id="enable-form"><label>Reason<textarea name="reason" minlength="3" maxlength="4000" required></textarea></label><button>'+(item.enabled?'Disable source':'Enable source')+'</button></form></details>'+
  '<hr><div class="toolbar"><h3>Original rows and disposition</h3><form id="source-search" class="search"><input name="search" value="'+E(state.sourceSearch)+'" placeholder="Find source text or row number" aria-label="Find source rows"><button>Find</button></form></div>'+
  (row?rowEditor(row,item,data.fields):'')+
  table(['Row','Original fields','Mapped record','Disposition','Review'],data.rows.map(r=>[E(r.number)+'<small class="muted"> · line '+E(r.line)+'</small>','<pre>'+E(pretty(Object.fromEntries(item.columns.map((c,i)=>[c,r.cells[i]]))))+'</pre>','<pre>'+E(pretty(r.mapped))+'</pre>',badge(r.disposition?.status||'unknown',['invalid','conflict'].includes(r.disposition?.status)?'error':'')+(r.disposition?.corrected?' '+badge('corrected'):'')+'<p class="muted">'+E(r.disposition?.reason)+'</p>',button('Review row','edit-row','data-row="'+r.number+'"')]))+
  pager(state.sourceOffset,data.total,50,'source-page');
}
function rowEditor(row,item,fields) {
  const overrides=item.corrections[row.number]||{},excluded=Boolean(item.excluded[row.number]);
  return '<section class="panel row-editor" id="row-editor"><div class="toolbar"><h3>Source row '+row.number+'</h3>'+button('Close row','close-row')+'</div><p class="form-note">Select the fields to override. The source remains available for comparison and download.</p><form id="correction-form"><div class="mapping-grid">'+fields.map(field=>{
    const on=Object.hasOwn(overrides,field),value=on?overrides[field]:row.mapped[field],values=state.view.enums[field];
    return '<div><label class="check"><input type="checkbox" data-override="'+E(field)+'"'+(on?' checked':'')+'> Override '+E(label(field))+'</label><label class="sr-only" for="correct-'+field+'">'+E(label(field))+'</label>'+(values?'<select id="correct-'+field+'" data-correct="'+E(field)+'"'+(!on?' disabled':'')+'>'+option('','Empty value',!value)+values.map(v=>option(v,label(v),v===value)).join('')+'</select>':field==='evidenceJson'?'<textarea id="correct-'+field+'" data-correct="'+E(field)+'"'+(!on?' disabled':'')+'>'+E(value)+'</textarea>':'<input id="correct-'+field+'" data-correct="'+E(field)+'" value="'+E(value)+'"'+(!on?' disabled':'')+'>')+'</div>';
  }).join('')+'</div><label>Reason for this correction<textarea name="reason" minlength="3" maxlength="4000" required></textarea></label><div class="actions"><button>Save row correction</button>'+button('Clear all overrides','clear-correction')+'</div></form>'+
  (item.correctionNotes?.[row.number]?'<p class="form-note">Latest correction: '+E(item.correctionNotes[row.number].reason)+' · '+E(item.correctionNotes[row.number].actor)+'</p>':'')+
  '<details><summary>'+(excluded?'Restore row to processing':'Exclude row with a reason')+'</summary><form id="exclude-form"><label>Disposition reason<textarea name="reason" minlength="3" maxlength="4000"'+(!excluded?' required':'')+'>'+E(item.excluded[row.number]?.reason||'')+'</textarea></label><button>'+(excluded?'Restore row':'Exclude row')+'</button></form></details></section>';
}
function findings() {
  const r=state.view.report;
  return '<section class="panel"><div class="toolbar"><div><h3>Findings and reviewer decisions</h3><p class="muted">'+r.summary.errors+' errors · '+r.summary.warnings+' warnings · '+r.summary.openIssues+' open findings</p></div><form id="issue-search" class="search"><input name="search" value="'+E(state.issueSearch)+'" placeholder="Search product, facility or finding" aria-label="Search findings"><button>Find</button></form></div>'+
  '<p class="form-note">Correct the source to resolve a finding. An accepted gap records a reviewer decision; stale decisions reopen when their source changes.</p>'+
  (r.issues.length?r.issues.map(issue=>{
    const refs=issue.sourceRows|| (issue.importId&&issue.row?[{importId:issue.importId,row:issue.row}]:[]),review=issue.review;
    return '<article class="finding"><div class="finding-head"><div>'+badge(issue.severity,issue.severity==='error'?'error':'')+' '+badge(issue.code)+'<p><strong>'+E(issue.message)+'</strong></p><p class="muted">'+E(issue.productIds?.join(', ')||issue.productId||issue.entityId||issue.target)+'</p></div></div>'+
      (refs.length?'<div class="actions">'+refs.slice(0,30).map(ref=>button('Source row '+ref.row,'finding-source','data-id="'+E(ref.importId)+'" data-row="'+ref.row+'"')).join('')+(refs.length>30?'<span class="muted">All '+refs.length+' source references are included in exports.</span>':'')+'</div>':'')+
      (review?'<div class="review-note">'+badge(review.status)+' '+(review.stale?badge('source changed','stale'):'')+'<p>'+E(review.note)+'</p><span class="muted">'+E(review.actor)+' · '+E(review.at)+'</span></div>':'')+
      '<details><summary>'+(review?'Update review decision':'Record a review decision')+'</summary><form class="review-form" data-key="'+E(issue.key)+'"><label>Disposition<select name="status">'+option('open','Keep open',review?.status!=='accepted-gap')+option('accepted-gap','Accept the documented gap',review?.status==='accepted-gap')+'</select></label><label>Decision and follow-up detail<textarea name="note" minlength="3" maxlength="4000" required>'+E(review?.note||'')+'</textarea></label><button>Save review decision</button></form></details></article>';
  }).join(''):'<div class="empty">No findings match this view.</div>')+pager(r.issueOffset,r.issueTotal,100,'issue-page')+'</section>'+
  (r.carriedReviews.length?'<section class="panel"><h3>Reviews whose finding is no longer present</h3>'+table(['Finding','Decision','Reviewer','Recorded'],r.carriedReviews.map(x=>[E(x.key),E(x.note),E(x.actor),E(x.at)]))+'</section>':'');
}
function exportsView() {
  const r=state.view.report;
  const cards=[['bundle','Portable workspace','Original source bytes, mappings, corrections, review report, workbook and complete relationship tables. Reopen with the restore command.'],['workbook','Excel review workbook','Linked tables for products, facilities, material links, evidence, findings and source dispositions.'],['report','Complete review JSON','Full audit result, complete upstream branches, every source row and reviewer decision.'],['graph','Normalized trace graph','Current mapped trace-evidence graph, ready for the original audit engine.']];
  return '<section class="panel"><h3>Revision '+state.view.state.revision+' handoff</h3><p>All exports use the current retained revision. Original source bytes are included in the portable workspace.</p><div class="export-grid">'+cards.map(([id,title,description])=>'<article class="export-card"><h3>'+title+'</h3><p class="muted">'+description+'</p>'+button('Download','export','data-type="'+id+'"'+(id==='graph'&&r.summary.errors?' disabled':''),false)+(id==='graph'&&r.summary.errors?'<p class="form-note">Resolve '+r.summary.errors+' source or graph errors to enable this export.</p>':'')+'</article>').join('')+'</div></section>'+
  '<section class="panel"><h3>Relationship tables</h3>'+table(['Table','Rows','Download'],state.view.exports.map(t=>[E(label(t.name)),E(t.rows),button('CSV','export','data-type="'+E(t.name)+'"')]))+'</section>'+
  '<section class="panel"><h3>Reopen a handoff</h3><p>On the receiving machine, extract the workbench source package, then restore the exported workspace into a new private directory:</p><pre>node workbench/server.mjs restore --bundle /path/trace-workspace.zip --data /private/restored-trace\nnode workbench/server.mjs --data /private/restored-trace</pre><p class="form-note">The receiving installation creates its own private operator access key. Source digests and record shapes are checked before the complete workspace is published.</p></section>';
}
function history(data) {
  return '<section class="panel"><h3>Retained edit history</h3>'+table(['Revision','Change','Reviewer','Recorded','Details'],data.history.map(h=>[E(h.revision),E(label(h.command?.type)),E(h.actor),E(h.at),'<details><summary>Open change</summary><pre>'+E(pretty(h.command))+'</pre></details>']))+pager(data.offset,data.total,100,'history-page')+'</section>';
}
async function fileBase64(file) {
  if(!file||!file.size||file.size>16*1024*1024)throw new Error('Choose a source file between 1 byte and 16 MiB.');
  const bytes=new Uint8Array(await file.arrayBuffer());let raw='';
  for(let offset=0;offset<bytes.length;offset+=16384)raw+=String.fromCharCode(...bytes.subarray(offset,offset+16384));
  return btoa(raw);
}
async function submit(form) {
  const data=new FormData(form);
  if(form.id==='login-form') {
    key=$('#access-key').value.trim();actor=$('#reviewer-name').value.trim();
    await refresh();sessionStorage.setItem('trace.operator.key',key);sessionStorage.setItem('trace.operator.actor',actor);$('#access-key').value='';return;
  }
  if(form.id==='options-form')return mutate({type:'options',title:data.get('title').trim(),asOf:data.get('asOf').trim(),maxAgeDays:Number(data.get('maxAgeDays'))});
  if(form.id==='upload-form') {
    const file=data.get('file'),kind=data.get('kind'),contentBase64=await fileBase64(file),previous=new Set(state.view.state.imports.map(i=>i.id));
    await mutate({type:kind==='graph'?'upload-graph':'upload',kind:kind==='graph'?undefined:kind,fileName:file.name,format:data.get('format'),contentBase64});
    const fresh=state.view.state.imports.find(i=>!previous.has(i.id));
    if(fresh){state.sourceId=fresh.id;state.sourceOffset=0;state.sourceSearch='';state.editRow=0;await render();}return;
  }
  if(form.id==='mapping-form') {
    const mapping={},valueMaps={};
    for(const select of form.querySelectorAll('[data-map-field]'))if(select.value)mapping[select.dataset.mapField]=select.value;
    for(const row of form.querySelectorAll('[data-enum-field]')) {
      const field=row.dataset.enumField,raw=row.querySelector('.enum-raw').value,value=row.querySelector('.enum-value').value;
      if(!value)continue;
      valueMaps[field]??={};if(Object.hasOwn(valueMaps[field],raw))throw new Error('Each source value may have one translation for '+label(field)+'.');
      Object.defineProperty(valueMaps[field],raw,{value,enumerable:true,writable:true,configurable:true});
    }
    return mutate({type:'mapping',importId:state.sourceId,mapping,valueMaps});
  }
  if(form.id==='correction-form') {
    const values={};for(const checkbox of form.querySelectorAll('[data-override]:checked')) {const field=checkbox.dataset.override;values[field]=form.querySelector('[data-correct="'+field+'"]').value;}
    return mutate({type:'correct',importId:state.sourceId,row:state.editRow,values,reason:data.get('reason')});
  }
  if(form.id==='exclude-form')return mutate({type:'exclude',importId:state.sourceId,row:state.editRow,excluded:!state.sourceData.import.excluded[state.editRow],reason:data.get('reason')});
  if(form.id==='enable-form')return mutate({type:'enable',importId:state.sourceId,enabled:!state.sourceData.import.enabled,reason:data.get('reason')});
  if(form.classList.contains('review-form'))return mutate({type:'review',issueKey:form.dataset.key,status:data.get('status'),note:data.get('note')});
  if(form.id==='source-search'){state.sourceSearch=data.get('search');state.sourceOffset=0;state.editRow=0;return render();}
  if(form.id==='issue-search'){state.issueSearch=data.get('search');state.issueOffset=0;return refresh();}
}
async function action(button) {
  const a=button.dataset.action;
  if(button.dataset.tab){state.tab=button.dataset.tab;return render();}
  if(a==='refresh')return refresh('Opened the current retained revision.');
  if(a==='retry')return mutate(null,state.pending);
  if(a==='logout') {
    key='';state.view=null;state.pending=null;sessionStorage.removeItem('trace.operator.key');$('#app').innerHTML='';session();notice('Workspace closed in this browser.');return;
  }
  if(a==='tab-sources'){state.tab='sources';return render();}
  if(a==='source'){state.sourceId=button.dataset.id;state.sourceOffset=0;state.sourceSearch='';state.editRow=0;return render();}
  if(a==='source-download')return download('/api/source?importId='+encodeURIComponent(state.sourceId));
  if(a==='source-page'){state.sourceOffset=Number(button.dataset.offset);state.editRow=0;return render();}
  if(a==='edit-row'){state.editRow=Number(button.dataset.row);$('#source-detail').innerHTML=sourceDetail(state.sourceData);$('#row-editor').scrollIntoView({block:'start',behavior:'smooth'});return;}
  if(a==='close-row'){state.editRow=0;$('#source-detail').innerHTML=sourceDetail(state.sourceData);return;}
  if(a==='suggest-mapping') {
    const suggestion=state.sourceData.suggestion;
    for(const select of $('#mapping-form').querySelectorAll('[data-map-field]'))select.value=suggestion[select.dataset.mapField]||'';
    notice('Matching headings are selected. Review them and save the field mapping.');return;
  }
  if(a==='add-enum') {
    const field=button.dataset.field;button.closest('.enum-section').querySelector('.enum-rows').insertAdjacentHTML('beforeend',enumRow(field));return;
  }
  if(a==='clear-correction') {
    const form=$('#correction-form'),reason=new FormData(form).get('reason');
    if(!reason.trim()||reason.trim().length<3){notice('Enter the reason for clearing these overrides.');form.querySelector('[name="reason"]').focus();return;}
    return mutate({type:'correct',importId:state.sourceId,row:state.editRow,values:{},reason});
  }
  if(a==='finding-source') {
    state.sourceId=button.dataset.id;state.editRow=Number(button.dataset.row);state.sourceOffset=Math.floor((state.editRow-1)/50)*50;state.sourceSearch='';state.tab='sources';await render();$('#row-editor')?.scrollIntoView({block:'start'});return;
  }
  if(a==='issue-page'){state.issueOffset=Number(button.dataset.offset);return refresh();}
  if(a==='history-page'){state.historyOffset=Number(button.dataset.offset);return render();}
  if(a==='trace-nodes'){state.nodeOffset=Number(button.dataset.offset);return loadTrace();}
  if(a==='trace-links'){state.linkOffset=Number(button.dataset.offset);return loadTrace();}
  if(a==='export')return download('/api/export/'+encodeURIComponent(button.dataset.type)+'?revision='+state.view.state.revision);
}
document.addEventListener('submit',event=>{event.preventDefault();submit(event.target).catch(error=>notice(error.message));});
document.addEventListener('click',event=>{const target=event.target.closest('button[data-action],button[data-tab]');if(target)action(target).catch(error=>notice(error.message));});
document.addEventListener('change',event=>{
  const target=event.target;
  if(target.id==='trace-product'){state.productId=target.value;state.nodeOffset=0;state.linkOffset=0;loadTrace().catch(e=>notice(e.message));}
  if(target.dataset.override){const field=target.dataset.override;$('#correction-form').querySelector('[data-correct="'+field+'"]').disabled=!target.checked;}
  if(target.id==='current-reviewer'){actor=target.value.trim();sessionStorage.setItem('trace.operator.actor',actor);}
  if(target.name==='file'&&target.files[0]) {const extension=target.files[0].name.split('.').pop().toLowerCase();if(['csv','tsv','json'].includes(extension))$('#upload-form [name="format"]').value=extension;}
});
$('#reviewer-name').value=actor;
if(key)refresh().catch(error=>{if(error.status===401){key='';sessionStorage.removeItem('trace.operator.key');}notice(error.message);});
