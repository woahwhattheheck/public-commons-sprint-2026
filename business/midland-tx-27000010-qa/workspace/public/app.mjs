// MIT. Industrial operator interface for the maintained Midland preflight/workspace.
const app=document.querySelector('#app'),notice=document.querySelector('#notice'),operator=document.querySelector('#operator');
const params=new URL(location.href).searchParams,secret=params.get('access');
if(secret){sessionStorage.setItem('midland-access',secret);const clean=new URL(location.href);clean.searchParams.delete('access');history.replaceState(null,'',clean);}
const token=sessionStorage.getItem('midland-access')||'';
operator.value=localStorage.getItem('midland-operator')||'';
operator.addEventListener('change',()=>localStorage.setItem('midland-operator',operator.value.trim()));
const esc=value=>String(value??'').replace(/[&<>"']/g,character=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]));
const label=value=>String(value??'').toLowerCase().replaceAll('_',' ').replace(/\b[a-z]/g,c=>c.toUpperCase());
const fmt=value=>Number(value??0).toLocaleString();
const date=value=>value?new Date(value).toLocaleString():'';
const size=value=>value>=1048576?(value/1048576).toFixed(1)+' MiB':value>=1024?(value/1024).toFixed(1)+' KiB':value+' bytes';
const tag=(value,dark=false)=>'<span class="tag'+(dark?' dark':'')+'">'+esc(label(value))+'</span>';
const option=(value,text,selected)=>'<option value="'+esc(value)+'"'+(value===selected?' selected':'')+'>'+esc(text)+'</option>';
const button=(action,text,extra='')=>'<button type="button" data-action="'+action+'" '+extra+'>'+text+'</button>';
let bootstrap,S=null,tab='sources',reviewRun=null,findingsPage=null,offset=0,filter={code:'',search:'',action:''},pollTimer=null,reviewIds=[];
function announce(message,error=false){notice.textContent=message;notice.className='show'+(error?' error':'');}
function busy(element,state){if(element)element.disabled=state;}
async function api(path,{method='GET',body,raw=false}={}){
  const headers={'X-Midland-Token':token};
  if(body!==undefined&&!raw)headers['Content-Type']='application/json';
  const response=await fetch('/api'+path,{method,headers,body:body===undefined?undefined:raw?body:JSON.stringify(body)});
  const result=await response.json();
  if(!response.ok)throw Object.assign(new Error(result.error||'The action failed.'),{status:response.status});
  return result;
}
function base(){return '/projects/'+encodeURIComponent(S.project.id);}
function mutation(value={}){
  const actor=operator.value.trim();if(!actor)throw Error('Enter your name in the Operator field before saving.');
  localStorage.setItem('midland-operator',actor);return {...value,actor,expected:S.project.revision};
}
async function upload(file){
  if(!file||!file.size)throw Error('Choose a nonempty source file.');
  if(file.size>bootstrap.upload_limit)throw Error('This source exceeds the configured '+size(bootstrap.upload_limit)+' upload limit.');
  return api(base()+'/uploads?name='+encodeURIComponent(file.name||'dictionary.json'),{method:'POST',body:file,raw:true});
}
async function download(action,input={}){
  announce('Preparing the retained file…');
  const value=await api(base()+'/'+action,{method:'POST',body:input});
  const link=document.createElement('a');link.href=value.download_url;link.download=value.filename;document.body.append(link);link.click();link.remove();
  announce('Download prepared: '+value.filename+' · '+size(value.size)+' · SHA-256 '+value.sha256);
  return value;
}
function localJson(filename,value){
  const url=URL.createObjectURL(new Blob([JSON.stringify(value,null,2)+'\n'],{type:'application/json'}));
  const link=document.createElement('a');link.href=url;link.download=filename;link.click();setTimeout(()=>URL.revokeObjectURL(url),10000);
}
async function refresh(projectId=S?.project.id){
  if(!projectId){bootstrap=await api('/bootstrap');renderHome();return;}
  const changed=S?.project.id!==projectId;
  S=await api('/projects/'+encodeURIComponent(projectId));
  if(changed){tab='sources';reviewRun=null;findingsPage=null;offset=0;filter={code:'',search:'',action:''};reviewIds=[];document.querySelector('#review-dialog').close();}
  const currentUrl=new URL(location.href);currentUrl.searchParams.set('project',projectId);history.replaceState(null,'',currentUrl);
  if(!reviewRun||!S.runs.some(run=>run.id===reviewRun))reviewRun=S.runs.find(run=>run.status==='COMPLETED')?.id||S.runs[0]?.id||null;
  renderWorkspace();if(tab==='review'&&reviewRun)await loadFindings();
  schedulePoll();
}
function renderHome(){
  S=null;clearTimeout(pollTimer);
  const homeUrl=new URL(location.href);homeUrl.searchParams.delete('project');history.replaceState(null,'',homeUrl);
  app.innerHTML='<div class="heading"><div><div class="eyebrow">RFP 27000010 · Operator workspace</div><h1>Geospatial delivery projects</h1><p class="muted">Retained sources, complete attribute review, correction history and delivery editions.</p></div></div>'+
    '<div class="grid"><section class="panel"><h2>Open a retained project</h2><div class="cards">'+
    (bootstrap.projects.length?bootstrap.projects.map(p=>'<article class="panel case-card"><h3>'+esc(p.title)+'</h3><p class="meta">'+esc(p.owner)+' · Revision '+p.revision+'</p><p class="meta">'+esc(date(p.updated_at))+'</p>'+button('open-project','Open project','data-id="'+esc(p.id)+'"')+'</article>').join(''):'<p class="empty">Create the first project or reopen a retained case package.</p>')+
    '</div></section><div><section class="panel"><h2>Create project</h2><form id="create-project" class="stack"><label>Project name<input name="title" required maxlength="500" placeholder="Midland draft delivery"></label><p class="meta">The named operator becomes the recorded initial project owner.</p><button class="primary">Create project</button></form></section>'+
    '<section class="panel"><h2>Reopen a case package</h2><form id="restore-case" class="stack"><label>Retained case ZIP<input type="file" name="archive" accept=".zip" required></label><p class="meta">Opens a new private workspace with the original files and review history. Existing cases remain available.</p><button>Restore and open</button></form>'+
    (bootstrap.restored_cases.length?'<div class="divider"></div><h3>Previously reopened cases</h3>'+bootstrap.restored_cases.map(p=>'<div class="version"><p>'+esc(p.title)+'</p>'+button('open-restored','Open retained case','data-id="'+esc(p.id)+'"')+'</div>').join(''):'')+'</section></div></div>';
}
function runStatus(){
  const active=S.runs.find(run=>run.status==='RUNNING'),latest=S.runs[0];
  if(active)return '<div class="panel slim progress"><p><strong>Attribute review running</strong><br><span class="meta">'+esc(active.progress.feature_class||'Opening retained sources')+' · '+fmt(active.progress.total_observed_rows)+' rows · '+fmt(active.progress.findings)+' findings retained</span></p>'+button('stop-run','Stop review','data-id="'+active.id+'"')+'</div>';
  if(latest&&['FAILED','INTERRUPTED','CANCELLED'].includes(latest.status))return '<div class="panel slim progress"><p><strong>'+esc(label(latest.status))+'</strong><br><span class="meta">'+esc(latest.error)+'</span></p>'+button('retry-run','Rerun retained inputs','data-id="'+latest.id+'"')+'</div>';
  return '';
}
function renderWorkspace(){
  const latest=S.runs.find(run=>run.status==='COMPLETED'),findings=latest?Object.values(latest.reports).reduce((n,r)=>n+Object.values(r.problem_totals).reduce((a,b)=>a+b,0),0):0;
  const count=Object.keys(S.project.selection).length;
  app.innerHTML='<div class="heading"><div><div class="eyebrow">RFP 27000010 · Revision '+S.project.revision+'</div><h1>'+esc(S.project.title)+'</h1><p class="meta">Project owner '+esc(S.project.owner)+' · '+esc(date(S.project.updated_at))+'</p></div><div class="toolbar">'+button('refresh','Refresh')+button('backup','Download reopenable case')+'</div></div>'+
    '<div class="metrics"><div class="metric"><strong>'+count+' / 4</strong><span>Selected feature classes</span></div><div class="metric"><strong>'+S.sources.length+'</strong><span>Retained source versions</span></div><div class="metric"><strong>'+fmt(findings)+'</strong><span>Findings in latest complete review</span></div><div class="metric"><strong>'+S.releases.length+'</strong><span>Prepared delivery editions</span></div></div>'+
    '<div id="run-status">'+runStatus()+'</div><nav class="tabs" aria-label="Project sections">'+
    [['sources','Source intake'],['review','Findings & corrections'],['dictionary','City dictionary'],['delivery','Delivery & acceptance'],['history','History']].map(([id,name])=>'<button type="button" data-tab="'+id+'" class="'+(tab===id?'active':'')+'">'+name+'</button>').join('')+'</nav>'+
    ({sources:sourceView,review:reviewView,dictionary:dictionaryView,delivery:deliveryView,history:historyView}[tab])();
}
function sourceView(){
  return '<div class="grid"><div><section class="panel"><h2>Selected source versions</h2><form id="select-sources" class="stack">'+S.classes.map(c=>
    '<label>'+esc(c)+'<select name="'+esc(c)+'">'+option('','Not selected','')+S.sources.filter(s=>s.feature_class===c).map(s=>option(s.id,s.label+' · '+(s.sample?'Representative sample':'Full population'),S.project.selection[c])).join('')+'</select></label>').join('')+
    '<div class="toolbar"><button>Save selection</button>'+button('start-run','Run attribute review','class="primary"'+(S.runs.some(r=>r.status==='RUNNING')?' disabled':''))+'</div></form><p class="meta">The original preflight checks ArcGIS field metadata and exported attributes. Each run freezes the selected versions and dictionary.</p></section>'+
    '<section class="panel"><h2>Source history</h2>'+(S.sources.length?S.sources.map(s=>'<div class="version"><header><strong>'+esc(s.label)+'</strong>'+tag(s.sample?'sample':'full population')+'</header><p class="meta">'+esc(s.feature_class)+' · '+esc(s.actor)+' · '+esc(date(s.created_at))+'</p>'+(s.parent_id?'<p class="meta">Correction of '+esc(S.sources.find(p=>p.id===s.parent_id)?.label||s.parent_id)+'</p>':'')+
    '<p class="meta">'+esc(s.source_ref)+'</p><div class="hash">Rows '+esc(s.rows_sha)+'</div><div class="toolbar">'+button('source-download','Metadata','data-id="'+s.id+'" data-kind="metadata" class="quiet"')+button('source-download','Attributes','data-id="'+s.id+'" data-kind="rows" class="quiet"')+'</div></div>').join(''):'<p class="empty">No retained source versions yet.</p>')+'</section></div>'+
    '<div><section class="panel"><h2>Retain source or correction</h2><form id="import-source" class="form-grid"><label class="full">Version label<input name="label" required maxlength="500" placeholder="Parcel attributes · draft 1"></label><label class="full">Original ArcGIS metadata JSON<input type="file" name="metadata" accept=".json" required></label><label class="full">Original attribute rows NDJSON<input type="file" name="rows" accept=".ndjson,.jsonl" required></label>'+
    '<label class="full">Review scope<select name="sample"><option value="true">Representative sample</option><option value="false">Full population</option></select></label><label class="full">Corrects an earlier source<select name="parent_id">'+option('','New source',null)+S.sources.map(s=>option(s.id,s.feature_class+' · '+s.label,null)).join('')+'</select></label>'+
    '<label class="full">Original source reference<textarea name="source_ref" placeholder="Delivery location, export date or City correspondence"></textarea></label><div class="actions"><button class="primary">Retain source version</button></div></form><p class="meta">Per-file limit: '+size(bootstrap.upload_limit)+'. Original bytes are retained; corrections create another version.</p></section>'+
    '<section class="panel"><h2>Compare original ArcGIS REST data</h2><form id="import-arcgis" class="form-grid"><label class="full">Source comparison label<input name="label" required placeholder="Existing parcel service against proposed delivery schema"></label><label class="full">Original layer metadata JSON<input type="file" name="layer" accept=".json" required></label><label class="full">Original feature response JSON<input type="file" name="response" accept=".json,.esrijson" required></label><label class="full">Target RFP feature class<select name="target_class">'+S.classes.map(c=>option(c,c,'IMP_SURFACE_PARCELS')).join('')+'</select></label><label class="full">Scope<select name="sample"><option value="true">Sample response</option><option value="false">Complete original population</option></select></label><label class="full">Original service or capture reference<input name="source_ref" required></label><div class="actions"><button>Retain and compare source</button></div></form><p class="meta">Field names stay unchanged; native UTC date values are rendered as ISO dates. The original response retains all values and geometry; the selected target identifies the comparison, not the acquired source schema.</p></section>'+
    '<section class="panel"><h2>Export from the original geodatabase</h2><p class="meta">Use the included ArcPy adapter in the prime’s licensed ArcGIS environment. Upload its metadata JSON and NDJSON pair here. Geodatabases, LAS/LAZ, DEMs and source correspondence can be retained under Delivery & acceptance.</p><details><summary>Original command</summary><pre>python arcpy_export.py /secure/work.gdb/IMP_SURFACE_PARCELS /secure/qa/parcels</pre></details></section></div></div>';
}
function runOptions(selected){return S.runs.map(run=>option(run.id,date(run.created_at)+' · '+label(run.status),selected)).join('');}
function reviewView(){
  if(!S.runs.length)return '<section class="panel"><p class="empty">Retain sources and run the original attribute review to open findings.</p></section>';
  const r=S.runs.find(x=>x.id===reviewRun);
  const codes=[...new Set(r?.reports.flatMap(report=>Object.keys(report.problem_totals))||[])].sort();
  return '<section class="panel"><header><h2>Complete finding register</h2><p class="meta">Every retained observation, beyond the compact report’s example limit.</p></header>'+
    '<form id="finding-filters" class="filters"><label>Review run<select name="run">'+runOptions(reviewRun)+'</select></label><label>Finding code<select name="code">'+option('','All finding codes',filter.code)+codes.map(code=>option(code,code,filter.code)).join('')+'</select></label><label>Review state<select name="action">'+option('','All states',filter.action)+['OPEN','ASSIGNED','CORRECTION_REQUESTED','ACCEPTED_EXCEPTION','REOPENED'].map(s=>option(s,label(s),filter.action)).join('')+'</select></label>'+
    '<label>Record, field or detail<input name="search" value="'+esc(filter.search)+'"></label><button>Apply filters</button></form>'+
    '<div class="toolbar">'+button('review-selected','Review selected findings')+'<span class="meta">One assignment or decision can cover up to 50 findings on this page.</span></div><div id="findings"><p class="empty">Loading findings…</p></div></section>'+
    '<section class="panel"><h2>Compare correction runs</h2><form id="compare-runs" class="filters"><label>Earlier review<select name="previous">'+S.runs.filter(run=>run.status==='COMPLETED').map(run=>option(run.id,date(run.created_at),S.runs.filter(x=>x.status==='COMPLETED')[1]?.id)).join('')+'</select></label><label>Later review<select name="current">'+S.runs.filter(run=>run.status==='COMPLETED').map(run=>option(run.id,date(run.created_at),reviewRun)).join('')+'</select></label><button>Compare retained results</button></form><div id="comparison"><p class="meta">A correction replaces a selected source version. Unchanged, unambiguous rows may carry their source-bound review decisions; changed rows and dictionaries require a fresh decision.</p></div></section>';
}
async function loadFindings(){
  const query=new URLSearchParams({run:reviewRun,offset:String(offset),limit:'50',...filter});
  findingsPage=await api(base()+'/findings?'+query);
  const mount=document.querySelector('#findings');if(!mount)return;
  const run=S.runs.find(x=>x.id===reviewRun);
  mount.innerHTML=findingsPage.total?'<div class="table-wrap"><table><thead><tr><th><input type="checkbox" id="select-all-findings" aria-label="Select findings on this page"></th><th>Source / record</th><th>Finding</th><th>Review state</th><th></th></tr></thead><tbody>'+findingsPage.findings.map(f=>
    '<tr><td><input type="checkbox" name="selected-finding" value="'+esc(f.id)+'" aria-label="Select '+esc(f.code)+' '+esc(f.record_key)+'"></td><td class="source"><strong>'+esc(f.feature_class)+'</strong><br>'+esc(f.record_key)+'<br><span class="meta">'+esc(f.location)+'</span></td><td class="finding-detail"><strong>'+esc(f.code)+'</strong><p>'+esc(f.detail)+'</p><span class="meta">'+esc(label(f.rule_origin))+'</span></td><td>'+tag(f.action||'OPEN')+(f.inherited_decision?'<p class="meta">Carried from unchanged source</p>':'')+'<p class="meta">'+esc(f.owner||'')+'</p></td><td>'+button('review-finding','Review','data-id="'+esc(f.id)+'" class="quiet"'+(run.status!=='COMPLETED'?' disabled':''))+'</td></tr>').join('')+
    '</tbody></table></div><div class="pager"><span>'+fmt(offset+1)+'–'+fmt(Math.min(offset+50,findingsPage.total))+' of '+fmt(findingsPage.total)+'</span>'+button('previous-page','Previous',offset?'':'disabled')+button('next-page','Next',offset+50<findingsPage.total?'':'disabled')+'</div>':'<p class="empty">No retained findings match this selection.</p>';
}
function numericStorageView(){
  const latest=S.runs.find(r=>r.status==='COMPLETED');
  const fields=(latest?.reports||[]).flatMap(r=>(r.numeric_storage_review?.fields||[]).map(f=>({...f,feature_class:r.feature_class})));
  const value=v=>v===null||v===undefined?'Not exported':String(v);
  return '<section class="panel"><h2>Numeric schema and physical storage</h2><p class="meta">The original dictionary retains all declared precision and scale values. File geodatabases ignore these storage parameters; a matching export does not establish physical database acceptance. Record the actual database and City decision in the physical-schema milestone.</p>'+
    (fields.length?'<div class="table-wrap"><table><thead><tr><th>Field</th><th>Declared precision / scale</th><th>Exported precision / scale</th></tr></thead><tbody>'+fields.map(f=>'<tr><td>'+esc(f.feature_class)+'<br><strong>'+esc(f.field)+'</strong></td><td>'+esc(f.declared_precision)+' / '+esc(f.declared_scale)+'</td><td>'+esc(value(f.exported_precision))+' / '+esc(value(f.exported_scale))+'<br><span class="meta">'+(f.metadata_matches?'Matches exported metadata':'Review original database')+'</span></td></tr>').join('')+'</tbody></table></div>':'<p class="empty">Run the selected sources to show their exported numeric metadata beside the declared dictionary.</p>')+'</section>';
}
function dictionaryView(){
  return '<div class="grid"><section class="panel"><header><h2>Working dictionary</h2>'+button('default-dictionary','Download RFP baseline','class="quiet"')+'</header><div class="note">Parcel identifier name and type, the ERU formula and later schema changes require their actual City decisions. Named semantic roles keep the original row checks bound to the selected fields.</div>'+
    '<form id="import-dictionary" class="form-grid"><label class="full">Dictionary JSON<textarea class="code" name="dictionary" spellcheck="false">'+esc(JSON.stringify(S.selected_dictionary,null,2))+'</textarea></label><label class="full">Or select an original dictionary JSON file<input type="file" name="file" accept=".json"></label>'+
    '<label class="full">Dictionary source reference<input name="source_ref" placeholder="Original delivery or City document reference"></label><label class="full">Recorded status<select name="approval"><option value="DRAFT">Working draft</option><option value="RECORDED_CITY_APPROVAL">Written City approval received</option></select></label>'+
    '<label>Approval author<input name="approver"></label><label>Approval date<input name="approval_date" type="date"></label><label class="full">Written approval reference<input name="approval_ref"></label><div class="actions"><button class="primary">Retain and select dictionary</button></div></form></section>'+
    '<div><section class="panel"><h2>Dictionary versions</h2><form id="select-dictionary" class="stack"><label>Selected version<select name="dictionary_id">'+option('','Original published RFP schema',S.project.dictionary_id||'')+S.dictionaries.map(d=>option(d.id,d.label+' · '+label(d.approval),S.project.dictionary_id)).join('')+'</select></label><button>Use this version</button></form>'+
    S.dictionaries.map(d=>'<div class="version"><strong>'+esc(d.label)+'</strong><p>'+tag(d.approval)+'</p><p class="meta">'+esc(d.source_ref)+'</p><p class="meta">'+esc(d.approver)+' '+esc(d.approval_date)+' '+esc(d.approval_ref)+'</p><div class="hash">'+esc(d.sha256)+'</div></div>').join('')+'</section>'+
    '<section class="panel"><h2>City review sequence</h2><ol class="meta"><li>Retain the current original packet and addenda.</li><li>Record notice to proceed and the dictionary due date (30 calendar days).</li><li>Record written dictionary approval before acquisition and the City’s 10-business-day review.</li><li>Provide at least five representative records and record the 5-business-day load validation.</li><li>Retain written approval of later schema modifications.</li></ol><p class="meta">The original excerpt has inconsistent NTP timing. Section 5.5.4 places the sample before full delivery, while the section 6 schedule places sample validation before acquisition. Retain the City’s actual timing clarification; no schedule is inferred here.</p></section>'+numericStorageView()+'</div></div>';
}
function deliveryView(){
  const completed=S.runs.filter(r=>r.status==='COMPLETED');
  return '<div class="grid"><div><section class="panel"><h2>Prepare a delivery edition</h2><form id="prepare-edition" class="form-grid"><label class="full">Completed attribute review<select name="run_id" required>'+completed.map(run=>option(run.id,date(run.created_at)+' · '+run.reports.length+' classes',reviewRun)).join('')+'</select></label><label class="full">Edition label<input name="label" required placeholder="Draft review · correction 1"></label>'+
    '<label class="full">Handoff context<textarea name="note" required placeholder="Review scope, remaining City checks and the included files"></textarea></label><div class="full"><h3>Include retained delivery files</h3>'+S.artifacts.map(a=>'<label class="check"><input type="checkbox" name="artifact_ids" value="'+a.id+'" checked><span>'+esc(a.label)+'<br><span class="meta">'+esc(label(a.role))+' · '+size(a.size)+'</span></span></label>').join('')+'</div><div class="actions"><button class="primary"'+(!completed.length?' disabled':'')+'>Prepare CSV, PDF and delivery ZIP</button></div></form><p class="meta">The edition freezes the chosen run, source bytes, dictionary, review decisions and milestone records. It does not mark the project accepted.</p></section>'+
    '<section class="panel"><h2>Prepared editions</h2>'+(S.releases.length?S.releases.map(r=>'<div class="version"><header><strong>'+esc(r.label)+'</strong><span class="meta">'+esc(date(r.created_at))+'</span></header><p class="meta">'+esc(r.reviewer)+' · '+esc(r.note)+'</p><div class="toolbar">'+
    [['delivery.zip','Delivery ZIP'],['inventory.pdf','PDF inventory'],['inventory.csv','CSV inventory'],['findings.csv','Complete findings']].map(([name,text])=>button('edition-download',text,'data-id="'+r.id+'" data-name="'+name+'" class="quiet"')).join('')+'</div></div>').join(''):'<p class="empty">No delivery editions prepared.</p>')+'</section>'+
    '<section class="panel"><h2>City acceptance and delivery records</h2><div class="note">Attribute review and City acceptance remain separate. A received milestone stores the operator’s original correspondence reference.</div><div class="table-wrap"><table><thead><tr><th>Milestone</th><th>Recorded status</th><th>Owner / date</th></tr></thead><tbody>'+S.readiness.milestones.map(m=>'<tr><td>'+esc(m.title)+'<br><span class="meta">Section '+esc(m.section)+'</span></td><td>'+tag(m.record?.status||'NOT_STARTED')+'</td><td>'+esc(m.record?.owner||'')+'<br>'+esc(m.record?.due_date||'')+'</td></tr>').join('')+'</tbody></table></div></section></div>'+
    '<div><section class="panel"><h2>Retain delivery or source file</h2><form id="import-artifact" class="form-grid"><label class="full">Inventory label<input name="label" required></label><label class="full">File role<select name="role">'+S.artifact_roles.map(role=>option(role,label(role),'delivery_other')).join('')+'</select></label><label class="full">Original file<input type="file" name="file" required></label><label class="full">Original source reference<textarea name="source_ref"></textarea></label><div class="actions"><button>Retain file</button></div></form></section>'+
    '<section class="panel"><h2>Retained files</h2>'+(S.artifacts.length?S.artifacts.map(a=>'<div class="version"><strong>'+esc(a.label)+'</strong><p class="meta">'+esc(label(a.role))+' · '+size(a.size)+'</p><p class="meta">'+esc(a.source_ref)+'</p><div class="hash">'+a.sha256+'</div>'+button('artifact-download','Download original','data-id="'+a.id+'" class="quiet"')+'</div>').join(''):'<p class="empty">Retain the original packet, City GIS context and delivery files here.</p>')+'</section>'+
    '<section class="panel"><h2>Record a milestone</h2><form id="save-milestone" class="form-grid"><label class="full">Milestone<select name="milestone">'+S.readiness.milestones.map(m=>option(m.id,m.title,null)).join('')+'</select></label><label>Status<select name="status">'+['NOT_STARTED','IN_PROGRESS','RECEIVED','CORRECTION_REQUESTED','NOT_APPLICABLE'].map(v=>option(v,label(v),'IN_PROGRESS')).join('')+'</select></label><label>Responsible person<input name="owner"></label><label class="full">Recorded due date<input name="due_date" type="date"></label><label class="full">Context / actual timing<textarea name="note" required></textarea></label><label class="full">Original source reference<input name="source_ref"></label><label class="full">Linked retained file<select name="artifact_id">'+option('','No retained file',null)+S.artifacts.map(a=>option(a.id,a.label,null)).join('')+'</select></label><div class="actions"><button>Record milestone</button></div></form></section></div></div>';
}
function historyView(){
  return '<div class="grid"><section class="panel"><h2>Project history</h2><p class="meta">Latest 200 operator events. The reopenable case preserves the complete history.</p>'+
    S.history.map(e=>'<div class="history-item"><strong>'+esc(label(e.kind))+'</strong> <span class="meta">Revision '+e.revision+'</span><p>'+esc(e.actor)+' · '+esc(date(e.created_at))+'</p><details><summary>Recorded change</summary><pre>'+esc(JSON.stringify(e.payload,null,2))+'</pre></details></div>').join('')+'</section>'+
    '<section class="panel"><h2>Milestone correspondence history</h2>'+(S.milestone_history.length?S.milestone_history.map(m=>'<div class="history-item"><strong>'+esc(label(m.milestone))+'</strong><p>'+tag(m.status)+'</p><p>'+esc(m.note)+'</p><p class="meta">'+esc(m.owner)+' · '+esc(m.due_date)+' · '+esc(m.source_ref)+'</p><p class="meta">'+esc(m.actor)+' · '+esc(date(m.created_at))+'</p></div>').join(''):'<p class="empty">No milestone correspondence recorded.</p>')+'</section></div>';
}
async function openReview(ids){
  if(!ids.length)throw Error('Select findings on this page first.');
  reviewIds=ids;const f=ids.length===1?findingsPage.findings.find(f=>f.id===ids[0]):null;
  const dialog=document.querySelector('#review-dialog'),mount=document.querySelector('#review-content');
  mount.innerHTML='<div class="dialog-heading"><div><h2>'+esc(f?f.code:ids.length+' selected findings')+'</h2><p class="meta">'+esc(f?f.record_key+' · '+f.location:'The same assignment or decision will be appended to every selected finding.')+'</p></div>'+button('close-review','Close','class="quiet"')+'</div>'+
    '<div class="dialog-grid"><div>'+(f?'<p>'+esc(f.detail)+'</p><div id="source-row"><p class="meta">Opening retained source row…</p></div><div id="finding-history"></div>':'<p class="note">Bulk review retains one decision per original finding. The attribute results and original source files remain part of the case.</p>')+'</div>'+
    '<form id="save-review" class="stack"><label>Review action<select name="action">'+['ASSIGNED','CORRECTION_REQUESTED','ACCEPTED_EXCEPTION','REOPENED','NOTE'].map(a=>option(a,label(a),f?.action||'ASSIGNED')).join('')+'</select></label><label>Responsible reviewer<input name="owner" value="'+esc(f?.owner||operator.value)+'"></label><label>Decision and correction instructions<textarea name="note" required></textarea></label><label>Original review / written exception reference<input name="source_ref" value="'+esc(f?.source_ref||'')+'"></label><p class="meta">An accepted exception requires a source reference and remains a recorded exception to the finding. Notes do not replace the active assignment.</p><button class="primary">Save review decision</button></form></div>';
  dialog.showModal();
  if(f){
    const historyPromise=api(base()+'/finding-history?finding='+encodeURIComponent(f.id));
    if(f.line>0){
      const row=await api(base()+'/row?'+new URLSearchParams({run:reviewRun,source:f.source_id,line:String(f.line)}));
      document.querySelector('#source-row').innerHTML='<h3>Exact retained row · line '+row.line+'</h3><pre>'+esc(JSON.stringify(row.row??row.raw,null,2))+'</pre><div class="hash">'+row.row_sha+'</div>';
    }else document.querySelector('#source-row').innerHTML='<p class="meta">This observation belongs to the source metadata or the reviewed population.</p>';
    const history=await historyPromise;
    document.querySelector('#finding-history').innerHTML='<details><summary>Source-bound decision history ('+history.length+')</summary>'+history.map(h=>'<div class="history-item"><strong>'+esc(label(h.action))+'</strong><p>'+esc(h.note)+'</p><p class="meta">'+esc(h.actor)+' · '+esc(date(h.created_at))+' · '+esc(h.source_ref)+'</p></div>').join('')+'</details>';
  }
}
function schedulePoll(){
  clearTimeout(pollTimer);if(!S?.runs.some(run=>run.status==='RUNNING'))return;
  pollTimer=setTimeout(async()=>{
    try{
      const fresh=await api(base()),active=fresh.runs.some(run=>run.status==='RUNNING');
      S=fresh;document.querySelector('#run-status').innerHTML=runStatus();
      if(!active){announce('Attribute review completed. The retained results are ready.');await refresh();}
      else schedulePoll();
    }catch(e){announce(e.message,true);}
  },1500);
}
document.querySelector('#home-link').addEventListener('click',event=>{event.preventDefault();history.replaceState(null,'','/');refresh(null).catch(e=>announce(e.message,true));});
document.addEventListener('change',event=>{
  if(event.target.id==='select-all-findings')for(const checkbox of document.querySelectorAll('[name="selected-finding"]'))checkbox.checked=event.target.checked;
});
document.addEventListener('click',async event=>{
  const element=event.target.closest('button[data-action],button[data-tab]');if(!element)return;
  if(element.dataset.tab){tab=element.dataset.tab;renderWorkspace();if(tab==='review'&&reviewRun)await loadFindings().catch(e=>announce(e.message,true));return;}
  const action=element.dataset.action;busy(element,true);
  try{
    if(action==='open-project'){const url=new URL(location.href);url.searchParams.set('project',element.dataset.id);history.replaceState(null,'',url);await refresh(element.dataset.id);}
    else if(action==='open-restored'){const result=await api('/open-restored',{method:'POST',body:{id:element.dataset.id}});location.assign(result.url);}
    else if(action==='refresh')await refresh();
    else if(action==='backup')await download('backup');
    else if(action==='source-download')await download('source-download',{source_id:element.dataset.id,kind:element.dataset.kind});
    else if(action==='artifact-download')await download('artifact-download',{artifact_id:element.dataset.id});
    else if(action==='edition-download')await download('edition-download',{release_id:element.dataset.id,name:element.dataset.name});
    else if(action==='default-dictionary')localJson('midland-rfp-dictionary.json',bootstrap.default_dictionary);
    else if(action==='start-run'||action==='retry-run'){
      const result=await api(base()+'/runs',{method:'POST',body:mutation(action==='retry-run'?{parent_run_id:element.dataset.id}:{})});
      reviewRun=result.run_id;await refresh();announce('The original attribute preflight is running against the retained versions.');
    }
    else if(action==='stop-run'){await api(base()+'/stop-run',{method:'POST',body:mutation({run_id:element.dataset.id})});await refresh();}
    else if(action==='next-page'||action==='previous-page'){offset=Math.max(0,offset+(action==='next-page'?50:-50));await loadFindings();}
    else if(action==='review-finding')await openReview([element.dataset.id]);
    else if(action==='review-selected')await openReview([...document.querySelectorAll('[name="selected-finding"]:checked')].map(c=>c.value));
    else if(action==='close-review')document.querySelector('#review-dialog').close();
  }catch(e){announce(e.message,true);}finally{busy(element,false);}
});
document.addEventListener('submit',async event=>{
  const form=event.target;if(!form.id)return;event.preventDefault();
  const submit=form.querySelector('button[type=submit],button:not([type])');busy(submit,true);
  const fields=new FormData(form),values=Object.fromEntries([...fields.entries()].filter(([,value])=>typeof value==='string'));
  try{
    if(form.id==='create-project'){
      const owner=operator.value.trim();if(!owner)throw Error('Enter your name in the Operator field.');
      const state=await api('/projects',{method:'POST',body:{title:values.title,owner}});await refresh(state.project.id);announce('Project created. Retain the first source version.');
    }else if(form.id==='restore-case'){
      const archive=fields.get('archive');if(!archive?.size)throw Error('Choose a retained case ZIP.');
      announce('Verifying the retained package and opening a new workspace…');
      const result=await api('/restore',{method:'POST',body:archive,raw:true});location.assign(result.url);
    }else if(form.id==='import-source'){
      const input=mutation({...values,sample:values.sample==='true'});announce('Retaining the original metadata and attribute bytes…');
      const metadata=await upload(fields.get('metadata')),rows=await upload(fields.get('rows'));
      await api(base()+'/sources',{method:'POST',body:{...input,metadata_upload:metadata.id,rows_upload:rows.id}});
      await refresh();announce('Source version retained and selected.');
    }else if(form.id==='import-arcgis'){
      const input=mutation({...values,sample:values.sample==='true'});announce('Retaining the original ArcGIS layer and feature response…');
      const layer=await upload(fields.get('layer')),response=await upload(fields.get('response'));
      await api(base()+'/arcgis-source',{method:'POST',body:{...input,layer_upload:layer.id,response_upload:response.id}});
      await refresh();announce('Original ArcGIS source retained. Run the target-schema comparison from the selected sources.');
    }else if(form.id==='select-sources'){
      await api(base()+'/select-sources',{method:'POST',body:mutation({selection:Object.fromEntries(Object.entries(values).filter(([,value])=>value))})});await refresh();announce('Source selection saved.');
    }else if(form.id==='finding-filters'){
      reviewRun=values.run;filter={code:values.code,search:values.search,action:values.action};offset=0;await loadFindings();
    }else if(form.id==='save-review'){
      await api(base()+'/decisions',{method:'POST',body:mutation({...values,finding_ids:reviewIds})});
      document.querySelector('#review-dialog').close();await refresh();announce('Source-bound review decision saved.');
    }else if(form.id==='compare-runs'){
      const result=await api(base()+'/compare?'+new URLSearchParams(values));
      document.querySelector('#comparison').innerHTML='<div class="metrics"><div class="metric"><strong>'+fmt(result.persisting)+'</strong><span>Unchanged findings</span></div><div class="metric"><strong>'+fmt(result.resolved)+'</strong><span>Prior findings absent</span></div><div class="metric"><strong>'+fmt(result.introduced)+'</strong><span>New source-bound findings</span></div><div class="metric"><strong>'+(result.dictionary_changed?'Changed':'Same')+'</strong><span>Dictionary identity</span></div></div><p class="meta">'+esc(result.meaning)+'</p><details><summary>By feature class</summary><pre>'+esc(JSON.stringify(result.by_class,null,2))+'</pre></details>';
    }else if(form.id==='import-dictionary'){
      const input=mutation(values),chosen=fields.get('file'),file=chosen?.size?chosen:new File([values.dictionary],'dictionary.json',{type:'application/json'});
      const uploaded=await upload(file);await api(base()+'/dictionaries',{method:'POST',body:{...input,upload_id:uploaded.id,dictionary:undefined}});await refresh();announce('Dictionary retained and selected. Existing runs keep their original dictionary.');
    }else if(form.id==='select-dictionary'){
      await api(base()+'/select-dictionary',{method:'POST',body:mutation(values)});await refresh();announce('Dictionary selection saved.');
    }else if(form.id==='import-artifact'){
      const input=mutation(values),uploaded=await upload(fields.get('file'));
      await api(base()+'/artifacts',{method:'POST',body:{...input,upload_id:uploaded.id}});await refresh();announce('Original file retained in the project inventory.');
    }else if(form.id==='save-milestone'){
      await api(base()+'/milestones',{method:'POST',body:mutation(values)});await refresh();announce('Milestone correspondence recorded.');
    }else if(form.id==='prepare-edition'){
      announce('Freezing the delivery edition and generating the complete file inventory…');
      const result=await api(base()+'/releases',{method:'POST',body:mutation({...values,artifact_ids:fields.getAll('artifact_ids')})});
      await api(base()+'/build-edition',{method:'POST',body:{release_id:result.release_id}});
      await refresh();announce('Delivery edition prepared. The CSV inventory, PDF inventory, complete findings and original files are ready to download.');
    }
  }catch(e){announce(e.message,true);if(e.status===409&&S)await refresh().catch(()=>{});}
  finally{busy(submit,false);}
});
try{bootstrap=await api('/bootstrap');const selected=new URL(location.href).searchParams.get('project');if(selected)await refresh(selected);else renderHome();}
catch(e){app.innerHTML='<section class="panel"><h1>Open the local workspace</h1><p>'+esc(e.message)+'</p></section>';announce(e.message,true);}
