// MIT. Industrial portfolio operator; the native workspace owns source and decisions.
const $=s=>document.querySelector(s);
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const title=v=>String(v).replace(/([a-z])([A-Z])/g,'$1 $2').replace(/^./,s=>s.toUpperCase());
const number=v=>Number(v??0).toLocaleString('en-US');
function dollars(value){if(value===null||value===undefined)return '—';let n=BigInt(value),sign=n<0n?'-':'';if(n<0n)n=-n;const raw=n.toString().padStart(3,'0');return sign+raw.slice(0,-2).replace(/\B(?=(\d{3})+(?!\d))/g,',')+'.'+raw.slice(-2);}
const short=v=>String(v??'').slice(0,12);
const date=v=>v?String(v).replace('T',' ').replace(/\.\d+Z$/,' UTC'):'—';
const tag=v=>'<span class="tag'+(['COMPLETE','matched','reviewed','resolved'].includes(v)?' solid':'')+'">'+esc(v||'open')+'</span>';
const empty=(heading,text)=>'<div class="empty"><strong>'+esc(heading)+'</strong>'+esc(text)+'</div>';
const options=(rows,value,selectLabel='Choose a retained item')=>'<option value="">'+esc(selectLabel)+'</option>'+rows.map(r=>'<option value="'+esc(r.value)+'"'+(r.value===value?' selected':'')+'>'+esc(r.label)+'</option>').join('');
const input=(name,label,value='',type='text',extra='')=>'<div><label for="'+name+'">'+esc(label)+'</label><input id="'+name+'" name="'+name+'" type="'+type+'" value="'+esc(value)+'" '+extra+'></div>';
const area=(name,label,value='',extra='')=>'<div '+extra+'><label for="'+name+'">'+esc(label)+'</label><textarea id="'+name+'" name="'+name+'">'+esc(value)+'</textarea></div>';
const button=(action,label,data='',primary=false)=>'<button type="button" data-command="'+action+'" '+data+(primary?' class="primary"':'')+'>'+esc(label)+'</button>';
const split=v=>String(v??'').split(/[,\n]/).map(x=>x.trim()).filter(Boolean);
let token=location.hash.slice(1)||sessionStorage.getItem('openfema-session');
if(token){sessionStorage.setItem('openfema-session',token);if(location.hash)history.replaceState(null,'',location.pathname);}
const S={view:null,schema:null,section:'sources',table:'projects',search:'',sort:'',direction:'asc',offset:0,rows:null,detail:null,comparison:null,query:null,releaseStates:{},buyer:null,busy:false,pending:null,rowGeneration:0,detailGeneration:0};
const PENDING_SCHEMA='stellar-forge.openfema-browser-operation.v1';
async function api(path,body){
  const res=await fetch(path,{method:body===undefined?'GET':'POST',headers:{Authorization:'Bearer '+token,...(body===undefined?{}:{'Content-Type':'application/json'})},body:body===undefined?undefined:JSON.stringify(body)});
  const value=await res.json();if(!res.ok)throw Object.assign(new Error(value.message||value.error||'The workspace request did not finish.'),value,{status:res.status});return value;
}
function notify(message,error=false){const box=$('#notice');box.hidden=false;box.className='notice'+(error?' error':'');box.textContent=message;if(error&&S.pending){const b=document.createElement('button');b.type='button';b.dataset.command='retry';b.textContent='Reopen original operation';box.append(b);}}
function pendingKey(operationId){return 'openfema-pending:'+S.view.workspaceId+':'+operationId;}
function retainedRequests(){
  if(!S.view)return [];
  const prefix=pendingKey(''),records=[];
  for(const key of Object.keys(sessionStorage)){
    if(!key.startsWith(prefix))continue;
    try{
      const value=JSON.parse(sessionStorage.getItem(key));
      if(value?.schema===PENDING_SCHEMA&&value.workspaceId===S.view.workspaceId&&
        typeof value.operationId==='string'&&/^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(value.operationId)&&
        key===pendingKey(value.operationId)&&Object.hasOwn(S.schema.actions,value.action))records.push(value);
    }catch{}
  }
  return records.sort((a,b)=>String(b.savedAt).localeCompare(String(a.savedAt)));
}
function canonical(value){
  if(Array.isArray(value))return value.map(canonical);
  return value&&typeof value==='object'?Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])):value;
}
async function bundleIdentity(bundle){
  const bytes=new TextEncoder().encode(JSON.stringify(canonical(bundle)));
  const digest=await crypto.subtle.digest('SHA-256',bytes);
  return {sha256:Array.from(new Uint8Array(digest),x=>x.toString(16).padStart(2,'0')).join(''),bytes:bytes.length};
}
function nativeRequest(value){
  if(value.workspaceId&&value.workspaceId!==S.view.workspaceId)throw new Error('Open this original request in its selected workspace.');
  return {operationId:value.operationId,action:value.action,payload:value.payload??{},expectedRevision:value.expectedRevision};
}
async function pending(request){
  const record={...request,schema:PENDING_SCHEMA,workspaceId:S.view.workspaceId,savedAt:new Date().toISOString()};
  if(request.action==='source.import')record.originalSource=await bundleIdentity(request.payload.bundle);
  const saved={...record};
  if(record.originalSource&&JSON.stringify(saved).length>=64000){
    delete saved.payload;saved.needsOriginalSource=true;
  }
  sessionStorage.setItem(pendingKey(request.operationId),JSON.stringify(saved));
  S.pending=record;
}
function completePending(operationId){
  sessionStorage.removeItem(pendingKey(operationId));
  S.pending=retainedRequests()[0]??null;
}
async function originalRequest(operationId,{sourceBundle}={}){
  const retained=(S.pending?.operationId===operationId?S.pending:null)||
    retainedRequests().find(item=>item.operationId===operationId);
  const operation=await api('/api/operation?operationId='+encodeURIComponent(operationId));
  if(operation){
    if(operation.operationId!==operationId||!Object.hasOwn(S.schema.actions,operation.action)||
      retained&&retained.action!==operation.action)throw new Error('The original operation selection changed.');
    let payload=operation.payload;
    if(operation.action==='source.import'){
      if(!/^[a-f0-9]{64}$/.test(payload?.bundleSha256??''))throw new Error('The original source operation has no retained bundle.');
      payload={bundle:await api('/api/objects/'+payload.bundleSha256)};
      if(retained?.originalSource){
        const identity=await bundleIdentity(payload.bundle);
        if(identity.sha256!==retained.originalSource.sha256||identity.bytes!==retained.originalSource.bytes)
          throw new Error('The retained source bundle differs from this original browser operation.');
      }
    }else if(retained?.payload&&JSON.stringify(canonical(retained.payload))!==JSON.stringify(canonical(payload)))
      throw new Error('The retained original operation belongs to different inputs.');
    return {operationId,action:operation.action,payload,expectedRevision:S.view.revision};
  }
  if(retained?.payload)return {...nativeRequest(retained),expectedRevision:S.view.revision};
  if(retained?.needsOriginalSource){
    if(sourceBundle){
      const identity=await bundleIdentity(sourceBundle);
      if(identity.sha256!==retained.originalSource?.sha256||identity.bytes!==retained.originalSource?.bytes)
        throw new Error('Choose the same original source bundle for this retained operation.');
      return {operationId,action:'source.import',payload:{bundle:sourceBundle},expectedRevision:S.view.revision};
    }
    S.pending=retained;S.section='sources';render();$('#source-import').open=true;$('#source-file').focus();
    notify('Select the same original source bundle to continue '+operationId+'. Its source identity and operation ID are retained.');
    return null;
  }
  throw new Error('Choose a retained original operation from this workspace.');
}
async function resumeOperation(operationId){
  const request=await originalRequest(operationId);if(!request)return;
  await act(request.action,request.payload,request);if($('#record-dialog').open)$('#record-dialog').close();render();notify('Reopened original operation '+operationId+'.');
}
async function readSourceFile(file){
  const maximum=256*1024*1024;
  if(file.size>maximum)throw new Error('Choose a complete source package within 256 MiB.');
  const head=new Uint8Array(await file.slice(0,2).arrayBuffer());let stream=file.stream();
  if(head[0]===31&&head[1]===139){
    if(typeof DecompressionStream!=='function')throw new Error('Receive this gzip through the original native CLI or choose its complete JSON.');
    stream=stream.pipeThrough(new DecompressionStream('gzip'));
  }
  const reader=stream.getReader(),decoder=new TextDecoder('utf-8',{fatal:true}),parts=[];let size=0,complete=false;
  try{
    while(true){
      const item=await reader.read();if(item.done)break;
      size+=item.value.byteLength;
      if(size>maximum)throw new Error('The expanded source package exceeds 256 MiB.');
      parts.push(decoder.decode(item.value,{stream:true}));
    }
    parts.push(decoder.decode());complete=true;return JSON.parse(parts.join(''));
  }finally{if(!complete)await reader.cancel().catch(()=>{});reader.releaseLock();}
}
const version=()=>S.view?.versions.find(v=>v.id===S.view.selectedVersionId);
const portfolio=()=>S.view?.portfolios.find(p=>p.id===S.view.selectedPortfolioId);
const editionOptions=()=>S.view.editions.map(e=>({value:e.id,label:(e.label||'FEMA source')+' · '+date(e.completedAt)+' · '+number(e.datasets.projects.rowCount)+' projects'}));
const versionOptions=()=>S.view.versions.slice().reverse().map(v=>({value:v.id,label:v.criteria.name+' · v'+v.number+' · '+date(v.createdAt)}));
async function act(action,payload={},original=null){
  if(S.busy)throw new Error('The current workspace operation is still running.');
  const request=nativeRequest(original||{operationId:'browser-'+crypto.randomUUID(),action,payload,expectedRevision:S.view.revision});
  S.busy=true;document.body.setAttribute('aria-busy','true');
  try{
    await pending(request);
    const result=await api('/api/action',request);
    if(result.view?.workspaceId!==S.view.workspaceId)throw new Error('The returned operation belongs to another workspace.');
    if(Number.isInteger(result.view.revision)&&result.view.revision>=S.view.revision)S.view=result.view;
    completePending(request.operationId);return result.result;
  }
  catch(error){try{const view=await api('/api/view');if(view.workspaceId===S.view.workspaceId&&Number.isInteger(view.revision)&&view.revision>=S.view.revision)S.view=view;}catch{}throw error;}
  finally{S.busy=false;document.body.removeAttribute('aria-busy');updateHeader();}
}
async function download(path){const result=await api('/api/download-ticket',{path});const a=document.createElement('a');a.href=result.url;a.download=result.item.name;document.body.append(a);a.click();a.remove();notify('Prepared '+result.item.name+' · '+number(result.item.bytes)+' bytes.');}
function updateHeader(){
  if(!S.view)return;$('#connection').textContent=S.busy?'Saving original operation':'Workspace open';$('#identity').textContent=short(S.view.workspaceId)+' · revision '+S.view.revision;
  $('#footer-state').textContent=S.view.portfolios.length+' portfolios · '+S.view.editions.length+' source editions';
}
function renderSelection(){
  const p=portfolio(),v=version();
  $('#selection').innerHTML='<div><label for="selected-portfolio">Portfolio</label><select id="selected-portfolio">'+options(S.view.portfolios.map(p=>({value:p.id,label:p.name+' · '+p.number+' versions'})),p?.id,'Select a portfolio')+'</select></div><div><label for="selected-version">Saved version</label><select id="selected-version">'+options(S.view.versions.filter(x=>x.portfolioId===p?.id).slice().reverse().map(x=>({value:x.id,label:'Version '+x.number+' · '+x.reason+' · '+date(x.createdAt)})),v?.id,'Select a version')+'</select></div><div class="version-meta">'+(v?'SOURCE '+short(v.editionId)+'<br>VERSION '+short(v.id):'Capture an official source edition, then save a portfolio.')+'</div>';
}
function render(){
  if(!S.view)return;S.rowGeneration++;updateHeader();renderSelection();
  $('#navigation').innerHTML=[['sources','Sources'],['portfolios','Portfolios'],['review','Review'],['changes','Changes'],['publication','Publication'],['customer','Customer'],['handover','Handover']].map(([id,label])=>'<button type="button" data-command="section" data-section="'+id+'" aria-current="'+(S.section===id?'page':'false')+'">'+label+'</button>').join('');
  const screens={sources:renderSources,portfolios:renderPortfolio,review:renderReview,changes:renderChanges,publication:renderPublication,customer:renderCustomer,handover:renderHandover};
  $('#main').innerHTML=screens[S.section]();
  if(['portfolios','review'].includes(S.section)&&version())void loadRows().catch(e=>notify(e.message,true));
}
function heading(name,description){return '<div class="section-heading"><div><h2>'+name+'</h2><p>'+description+'</p></div></div>';}
function renderSources(){
  const captures=S.view.captures.slice().reverse().map(c=>{
    const ds=Object.entries(c.datasets||{}).map(([kind,d])=>{const total=d.sourceCount??d.filterBatches?.reduce((n,b)=>n+(b.sourceCount||0),0),count=d.rowCount??d.filterBatches?.reduce((n,b)=>n+(b.rowCount||0),0)??0;return '<div><h4>'+title(kind)+'</h4><strong>'+number(count)+'</strong><small>'+number(total)+' scoped source rows · '+number(d.pages||0)+' pages · '+esc(d.state||'ready')+'</small><progress max="'+Math.max(1,total)+'" value="'+count+'"></progress></div>';}).join('');
    return '<article class="capture"><header><div><strong>'+esc(c.label||'Public Assistance source')+'</strong><p class="small mono">'+short(c.id)+' · '+esc(date(c.createdAt))+'</p></div>'+tag(c.state)+'</header><div class="capture-grid">'+ds+'</div>'+(c.error?'<p class="warning">'+esc(c.error.message||c.error)+' '+esc(c.retryAt?'Resume after '+date(c.retryAt):'')+'</p>':'')+'<div class="actions">'+(['RUNNING','IMPORTING'].includes(c.state)?button('pause-capture','Pause capture','data-id="'+esc(c.id)+'"'):c.state!=='COMPLETE'?button('resume-capture','Continue retained capture','data-id="'+esc(c.id)+'"'):button('new-portfolio','Create portfolio','data-edition="'+esc(c.editionId||'')+'"'))+'</div></article>';
  }).join('');
  const editions=S.view.editions.map(e=>'<tr><td><strong>'+esc(e.label||'FEMA source')+'</strong><p class="small mono">'+short(e.id)+'</p></td><td>'+esc(date(e.completedAt))+'</td><td>'+number(e.datasets.declarations.rowCount)+'</td><td>'+number(e.datasets.applicants.rowCount)+'</td><td>'+number(e.datasets.projects.rowCount)+'</td><td><div class="row-actions">'+button('new-portfolio','Portfolio','data-edition="'+e.id+'"')+button('edition','Sources','data-id="'+e.id+'"')+button('source-export','Full source','data-id="'+e.id+'"')+'</div></td></tr>').join('');
  return heading('Official source editions','Capture the complete linked disaster cohort from FEMA, or receive a complete previously retained source bundle. Each dataset keeps its original pages, field dictionary and refresh observations.')+
    '<section class="panel"><h3>Capture a disaster cohort</h3><form id="capture-form"><div class="grid">'+input('capture-disasters','Disaster numbers','','text','placeholder="4724, 4725"')+input('capture-states','State codes','','text','placeholder="VT, FL"')+input('capture-from','Declarations from','','date')+input('capture-to','Declarations through','','date')+input('capture-label','Source edition label','Public Assistance source')+input('capture-page-size','Rows per source page','1000','number','min="1" max="10000"')+'<div class="span2 help">Use at least one selector. Different selectors intersect; values within a list are alternatives. Once disasters are selected, applicants and projects are acquired for the complete disaster cohort. Use a declaration date beginning in1953 for a full historical source.</div></div><div class="actions"><button class="primary" type="submit">Capture complete source</button><p>Progress is saved with every original page.</p></div></form></section>'+
    '<details id="source-import"><summary>Receive an original source bundle</summary><form id="import-form"><label for="source-file">Complete OpenFEMA source JSON or gzip</label><input class="file-picker" type="file" id="source-file" accept=".json,.gz,application/json,application/gzip" required><div class="actions"><button type="submit">Receive original source</button></div></form></details>'+
    (captures?'<section class="panel flush">'+captures+'</section>':'')+'<section class="panel"><h3>Retained source editions</h3>'+(editions?'<div class="table-wrap"><table><thead><tr><th>Edition</th><th>Completed</th><th>Declaration areas</th><th>Applicants</th><th>Projects</th><th>Open</th></tr></thead><tbody>'+editions+'</tbody></table></div>':empty('No complete source edition yet','Capture a cohort or receive an original bundle above.'))+'</section><details><summary>Source fields and interpretation</summary><div class="notes">'+Object.entries(S.schema.sourceNotes).map(([k,v])=>'<p><strong>'+title(k)+'</strong><br>'+esc(v)+'</p>').join('')+'</div></details>';
}
function criteriaFields(c={}){
  return '<div class="grid">'+input('portfolio-name','Portfolio name',c.name||'Public Assistance portfolio','text','required maxlength="160"')+'<div><label for="portfolio-edition">Source edition</label><select name="portfolio-edition" id="portfolio-edition" required>'+options(editionOptions(),version()?.editionId||S.view.editions[0]?.id)+'</select></div>'+input('portfolio-states','State codes',(c.states||[]).join(', '))+input('portfolio-disasters','Disaster numbers',(c.disasters||[]).join(', '))+input('portfolio-applicants','Applicant IDs',(c.applicants||[]).join(', '))+input('portfolio-counties','Original county names',(c.counties||[]).join(', '))+input('portfolio-categories','Work categories',(c.categories||[]).join(', '))+input('portfolio-min','Minimum federal dollars',c.minimumFederal||'','text','inputmode="decimal"')+input('portfolio-max','Maximum federal dollars',c.maximumFederal||'','text','inputmode="decimal"')+input('portfolio-from','Declaration date from',c.declarationFrom||'','date')+input('portfolio-to','Declaration date through',c.declarationTo||'','date')+'<div><label class="checkbox"><input name="portfolio-unjoined" type="checkbox" '+(c.includeUnjoined===false?'':'checked')+'>Include projects needing applicant review</label></div>'+area('portfolio-note','Purpose and selection notes',c.note||'','class="span4"')+'</div>';
}
function metrics(summary){
  const m=[['Disasters',number(summary.disasters)],['Applicants',number(summary.applicants)],['Selected / included projects',number(summary.selectedProjects)+' / '+number(summary.includedProjects)],['Open review issues',number(summary.openIssues)],['Project cost',dollars(summary.projectCostMinor),summary.missingProjectCosts+' missing'],['Federal obligations',dollars(summary.federalObligatedMinor),summary.missingFederalAmounts+' missing'],['Total obligations',dollars(summary.totalObligatedMinor),summary.missingTotalAmounts+' missing'],['Mitigation',dollars(summary.mitigationMinor),summary.missingMitigationAmounts+' missing']];
  return '<div class="metrics">'+m.map(([k,v,note])=>'<div class="metric"><span>'+k+'</span><strong>'+v+'</strong>'+(note?'<small>USD · '+esc(note)+'</small>':'')+'</div>').join('')+'</div>';
}
function renderPortfolio(){
  const v=version(),p=portfolio();
  return heading('Portfolio register','Select a saved source, define the portfolio and examine its exact source records. Each change creates a new retained version.')+
    '<details id="portfolio-editor" '+(!v?'open':'')+'><summary>'+(v?'Revise current portfolio or create another':'Create a portfolio')+'</summary><form id="portfolio-form">'+criteriaFields(v?.criteria)+'<div class="actions"><button class="primary" type="submit" name="intent" value="create">Save as new portfolio</button>'+(v&&p.currentVersionId===v.id?'<button type="submit" name="intent" value="revise">Save revised version</button>':'')+'</div></form></details>'+
    (!v?empty('Select a saved portfolio','Use a complete source edition to create the initial version.'):metrics(v.summary)+'<p class="small muted">Declaration and applicant registers retain scoped entities with zero matching projects. Funding totals include selected projects marked included. Each financial measure is separate.</p><div class="tabs">'+['projects','applicants','disasters','declarations','categories','issues'].map(t=>'<button type="button" data-command="table" data-table="'+t+'" aria-pressed="'+(S.table===t)+'">'+title(t)+'</button>').join('')+'</div>'+tableToolbar(S.table)+'<div id="portfolio-table">'+empty('Loading retained rows','The complete portfolio remains saved in this version.')+'</div><div class="actions">'+button('export','Spreadsheet CSV','data-format="csv"')+button('export','Full portfolio JSON','data-format="json"')+button('export','Complete report','data-format="html"')+'</div>');
}
function tableToolbar(table){return '<form id="table-form" class="toolbar"><div class="search"><label for="table-search">Search retained '+table+'</label><input id="table-search" name="search" value="'+esc(S.search)+'" placeholder="Name, county, disaster, source ID…"></div><div><label for="table-sort">Order by</label><select name="sort" id="table-sort">'+options((S.schema.tableColumns[table]||[]).map(k=>({value:k,label:title(k)})),S.sort,'Original order')+'</select></div><div><label for="table-direction">Direction</label><select name="direction" id="table-direction"><option value="asc"'+(S.direction==='asc'?' selected':'')+'>Ascending</option><option value="desc"'+(S.direction==='desc'?' selected':'')+'>Descending</option></select></div><button type="submit">Apply</button></form>';}
const visibleColumns={projects:['disasterNumber','applicantName','projectNumber','projectTitle','county','workCategory','federalObligated','mitigation','included','reviewStatus'],applicants:['disasterNumber','applicantId','name','city','projects','federalObligated','joinState'],disasters:['disasterNumber','title','state','incidentType','projects','federalObligated'],declarations:['disasterNumber','designatedArea','declarationDate','publicAssistance','fipsCountyCode'],categories:['category','projects','applicants','projectCost','federalObligated','totalObligated','mitigation'],issues:['code','subject','message','reviewStatus']};
async function loadRows(){
  const v=version(),section=S.section,table=section==='review'?'issues':S.table,generation=++S.rowGeneration;if(!v)return;
  S.rows=null;
  const loadingTarget=$('#portfolio-table');if(loadingTarget)loadingTarget.innerHTML=empty('Loading retained rows','Opening this exact version and table selection.');
  const query=new URLSearchParams({versionId:v.id,table,search:S.search,sort:S.schema.tableColumns[table].includes(S.sort)?S.sort:'',direction:S.direction,offset:String(S.offset),limit:'100'});
  const rows=await api('/api/rows?'+query);
  if(generation!==S.rowGeneration||version()?.id!==v.id||S.section!==section||rows.table!==table)return;S.rows=rows;
  const target=$('#portfolio-table');if(!target)return;
  const cols=visibleColumns[table]||rows.columns;
  target.innerHTML=!rows.rows.length?empty('No records match this selection','Change the table search, ordering or portfolio criteria.'):'<div class="table-wrap"><table><thead><tr>'+cols.map(k=>'<th>'+title(k)+'</th>').join('')+'<th>Record</th></tr></thead><tbody>'+rows.rows.map((row,index)=>'<tr>'+cols.map(k=>'<td class="'+(['projectCost','federalObligated','totalObligated','mitigation'].includes(k)?'number':'')+'">'+(k==='reviewStatus'||k==='joinState'?tag(row[k]):esc(row[k]))+'</td>').join('')+'<td>'+button('record',table==='issues'?'Review':'Open','data-row="'+index+'" data-table="'+table+'"')+'</td></tr>').join('')+'</tbody></table></div>';
  target.innerHTML+='<div class="pagination"><span>'+number(rows.total)+' records · '+(rows.total?number(rows.offset+1)+'–'+number(Math.min(rows.offset+rows.limit,rows.total)):'0')+'</span><div class="actions"><button type="button" data-command="previous" '+(!S.offset?'disabled':'')+'>Previous</button><button type="button" data-command="next" '+(rows.nextOffset===null?'disabled':'')+'>Next</button></div></div>';
}
function renderReview(){
  const v=version(),p=portfolio();
  if(!v)return heading('Analyst review','Review joins, original source differences and portfolio treatment.')+empty('Select a portfolio','The retained version supplies the review queue.');
  const acceptances=S.view.acceptances.filter(a=>a.versionId===v.id);
  return heading('Analyst review','Open an issue to inspect original source records, choose an applicant match, assign an owner and record the portfolio treatment. The most specific recorded decision applies: project, applicant, then disaster.')+metrics(v.summary)+
    (p.currentVersionId!==v.id?'<p class="warning">You are viewing an earlier saved version. Select the current version to record new decisions.</p>':'')+
    tableToolbar('issues')+'<div id="portfolio-table"></div>'+
    '<details><summary>Record a version acceptance note</summary><form id="accept-form">'+area('accept-note','Review conclusion','','')+'<div class="actions"><button type="submit">Save acceptance note for this version</button></div></form>'+acceptances.map(a=>'<p class="small">'+esc(date(a.createdAt))+' · '+esc(a.note)+'</p>').join('')+'</details>';
}
function renderChanges(){
  const versions=versionOptions(),c=S.comparison;
  const saved=S.view.comparisons.slice().reverse().map(r=>'<tr><td>'+esc(date(r.createdAt))+'</td><td>'+short(r.beforeVersionId)+' → '+short(r.afterVersionId)+'</td><td>'+r.summary.added+' / '+r.summary.removed+' / '+r.summary.changed+'</td><td>'+button('download','Complete change file','data-path="'+r.export.downloadUrl+'"')+'</td></tr>').join('');
  let result='';
  if(c){result='<section class="panel"><h3>Saved edition comparison</h3><p class="warning">'+esc(c.scopeMeaning)+'</p><div class="metrics"><div class="metric"><span>Added</span><strong>'+number(c.summary.added)+'</strong></div><div class="metric"><span>Absent</span><strong>'+number(c.summary.removed)+'</strong></div><div class="metric"><span>Changed</span><strong>'+number(c.summary.changed)+'</strong></div><div class="metric"><span>Federal obligation difference · USD</span><strong>'+dollars(c.summary.federalDeltaMinor)+'</strong></div></div><p class="small">Project comparisons use the original gmProjectId. Source hash and refresh timestamps do not count as substantive project changes. The full saved change file includes every changed original field and its before/after page references.</p>'+button('download','Download complete change file','data-path="'+c.export.downloadUrl+'"',true)+'<details><summary>Changed records · first100</summary><pre>'+esc(JSON.stringify(c.preview.changed,null,2))+'</pre></details><details><summary>Added and absent records · first100 of each</summary><pre>'+esc(JSON.stringify({added:c.preview.added,removed:c.preview.removed},null,2))+'</pre></details></section>';}
  return heading('Changes across saved versions','Compare original project fields, amounts and analyst treatment. Scope changes remain visible with the result.')+'<section class="panel"><form id="compare-form"><div class="grid two"><div><label for="compare-before">Before</label><select id="compare-before" name="before" required>'+options(versions,S.view.versions.at(-2)?.id)+'</select></div><div><label for="compare-after">After</label><select id="compare-after" name="after" required>'+options(versions,version()?.id)+'</select></div></div><div class="actions"><button class="primary" type="submit">Compare saved versions</button></div></form></section>'+result+(saved?'<section class="panel"><h3>Complete saved comparisons</h3><div class="table-wrap"><table><thead><tr><th>Saved</th><th>Versions</th><th>Added / absent / changed</th><th>File</th></tr></thead><tbody>'+saved+'</tbody></table></div></section>':'');
}
function renderPublication(){
  const v=version(),datasets=S.view.datasets.slice().reverse(),releases=S.view.releases.slice().reverse();
  const ds=datasets.map(d=>'<tr><td><strong>'+esc(d.name)+'</strong><p class="small mono">'+esc(d.id)+'</p></td><td>'+esc(d.table||'projects')+'</td><td>'+number(d.rows)+'</td><td class="mono">'+short(d.snapshot)+'</td><td>'+button('query-dataset','Query','data-id="'+d.id+'"')+' '+button('choose-dataset','Release','data-id="'+d.id+'"')+'</td></tr>').join('');
  const rr=releases.map(r=>{
    const state=S.releaseStates[r.id],selection=state?.selection||r.selection,bound=r.dataset?.datasetDirectory,moved=S.view.restoredFrom&&bound&&!bound.startsWith(S.view.restoredFrom.to+'/'),generation=selection?.generation;
    return '<article class="release"><div class="card-heading"><div><h4>'+esc(r.id)+'</h4><span class="mono small">'+short(r.digest)+' · '+short(r.snapshot)+'</span></div>'+tag(selection?.active===r.id?'ACTIVE':r.mode||'STAGED')+'</div><div class="status-line"><span>Generation '+esc(generation??'inspect')+'</span><span>'+esc(state?.publisher?.releases?.runtime?.state||r.publisher?.releases?.runtime?.state||'retained')+'</span><span>'+esc(r.release?.publicOrigin||'')+'</span></div>'+
      (moved?'<p class="warning">This release retains its original filesystem location. Its dataset and payment terms are available to prepare a new release here.</p>':'')+
      '<div class="actions">'+button('release-inspect','Inspect','data-id="'+r.id+'"')+(moved?button('release-reprepare','Prepare here from original terms','data-id="'+r.id+'"',true):button('release-activate','Activate','data-id="'+r.id+'"')+' '+button('release-start','Start local release','data-id="'+r.id+'"')+' '+button('release-stop','Stop','data-id="'+r.id+'"')+' '+button('release-rollback','Rollback','data-id="'+r.id+'"'))+'</div>'+
      (state?'<details><summary>Original publisher and release state</summary><pre>'+esc(JSON.stringify(state,null,2))+'</pre></details>':'')+'</article>';
  }).join('');
  return heading('Dataset publication','Prepare a native dataset from an exact saved portfolio, query it and stage the original merchant release with your public payment terms.')+
    '<section class="panel"><h3>Prepare portfolio dataset</h3>'+(v?'<form id="dataset-form"><div class="grid three">'+input('dataset-name','Dataset name',v.criteria.name)+'<div><label for="dataset-table">Table</label><select id="dataset-table" name="table">'+options(Object.keys(S.schema.tableColumns).map(t=>({value:t,label:title(t)})),S.table)+'</select></div><div class="help">Saved version '+v.number+' · '+short(v.id)+'<br>Original source pages and complete analyst decisions accompany the dataset.</div></div><div class="actions"><button type="submit" class="primary">Prepare native dataset</button></div></form>':empty('Select a portfolio version','Dataset publication uses that exact saved version.'))+'</section>'+
    (ds?'<section class="panel"><h3>Retained datasets</h3><div class="table-wrap"><table><thead><tr><th>Dataset</th><th>Table</th><th>Rows</th><th>Snapshot</th><th>Operate</th></tr></thead><tbody>'+ds+'</tbody></table></div></section>':'')+
    '<details id="query-panel"><summary>Query a retained native dataset</summary><form id="query-form"><div class="grid two"><div><label for="query-dataset">Dataset</label><select name="dataset" id="query-dataset" required>'+options(datasets.map(d=>({value:d.id,label:d.name+' · '+number(d.rows)+' rows'})),S.query?.datasetId||datasets[0]?.id)+'</select></div>'+input('dataset-query','Native query parameters','limit=25','text','placeholder="limit=25"')+'</div><div class="actions"><button type="submit">Query original dataset</button></div></form><p class="help">The original dataset handler validates available filters, sorting and page limits. Financial columns stay exact decimal strings.</p>'+(S.query?'<pre>'+esc(JSON.stringify(S.query.result,null,2))+'</pre>':'')+'</details>'+
    '<details id="release-panel"><summary>Stage a release with public payment terms</summary><form id="release-form"><div class="grid two"><div><label for="release-dataset">Dataset</label><select id="release-dataset" name="dataset" required>'+options(datasets.map(d=>({value:d.id,label:d.name+' · '+short(d.snapshot)})),datasets[0]?.id)+'</select></div>'+input('release-origin','Canonical HTTPS service origin','','url','placeholder="https://your-service.example" required')+input('release-path','Public dataset path','/public-assistance')+'<div class="help">Local runtime: '+esc(S.view.capabilities.releaseRuntime.mode)+'<br>Use the installed release runtime configuration to select the original facilitator.</div>'+area('release-payment','Public payment terms JSON','{\n  "scheme": "exact",\n  "network": "",\n  "asset": "",\n  "amount": "",\n  "payTo": "",\n  "maxTimeoutSeconds": 60\n}','class="span2"')+'</div><div class="actions"><button type="submit" class="primary">Stage original merchant release</button></div></form></details>'+
    '<section class="panel"><h3>Retained releases</h3>'+(rr||empty('No release staged','Prepare a dataset and its public payment terms above.'))+'</section>';
}
function renderCustomer(){
  const received=S.view.receipts.slice().reverse().map(r=>'<article class="release"><h4>'+esc(r.id)+'</h4><p class="small">'+esc(date(r.createdAt))+' · '+esc((r.intentIds||[]).join(', '))+'</p><div class="actions">'+r.downloads.map(d=>button('download',d.name+' · '+number(d.bytes)+' bytes','data-path="'+d.downloadUrl+'"')).join('')+'</div></article>').join('');
  return heading('Customer delivery','Inspect the original buyer inbox, receive the selected paid pages into the maintained delivery engine and reopen every resulting customer file.')+
    '<section class="panel"><form id="buyer-form">'+area('buyer-intents','Original inbox intent IDs in page order','','')+'<p class="help">'+(S.view.capabilities.inboxConfigured?'The original private buyer inbox is configured for this workspace.':'Open this workspace with --inbox pointing to the original private buyer inbox to continue an acquisition.')+'</p><div class="actions"><button type="submit" name="intent" value="inspect">Inspect original selection</button><button type="submit" name="intent" value="receive" class="primary">Receive complete selected dataset</button></div></form>'+(S.buyer?'<pre>'+esc(JSON.stringify(S.buyer,null,2))+'</pre>':'')+'</section><section class="panel"><h3>Retained customer files</h3>'+(received||empty('No customer delivery received','Selected original inbox pages produce complete CSV, JSONL, review HTML and delivery manifests.'))+'</section>';
}
function renderHandover(){
  const v=version();
  const retained=retainedRequests().map(r=>'<tr><td class="mono">'+esc(r.operationId)+'</td><td>'+esc(r.action)+'</td><td>'+esc(date(r.savedAt))+'</td><td>'+(r.originalSource?'<span class="mono">'+esc(short(r.originalSource.sha256))+'</span> · '+number(r.originalSource.bytes)+' source bytes':'Original inputs retained')+'</td><td>'+button('resume-operation','Continue','data-id="'+esc(r.operationId)+'"')+'</td></tr>').join('');
  const legacy=sessionStorage.getItem('openfema-pending');
  const exports=S.view.exports.slice().reverse().map(x=>'<tr><td>'+esc(x.name)+'</td><td>'+esc(x.kind||x.format)+'</td><td>'+number(x.bytes)+'</td><td class="mono">'+short(x.sha256)+'</td><td>'+button('download','Download','data-path="'+x.downloadUrl+'"')+'</td></tr>').join('');
  const ops=S.view.operations.map(o=>'<tr><td class="mono">'+esc(o.operationId)+'</td><td>'+esc(o.action)+'</td><td>'+tag(o.state)+'</td><td>'+esc(date(o.completedAt||o.failedAt||o.createdAt))+'</td><td>'+button('operation','Open','data-id="'+esc(o.operationId)+'"')+'</td></tr>').join('');
  return heading('Handover and reopen','Download complete work products and the original workspace. Saved sources, review decisions, publication history and customer bytes travel together.')+
    '<div class="split"><section class="panel"><h3>Complete workspace</h3><p>The ZIP includes every original source page and metadata response, saved portfolio version, analyst decision, native dataset and publisher, release package and customer delivery.</p><div class="actions">'+button('workspace-export','Download complete workspace ZIP','',true)+'</div><p class="help">Pause an active source capture before making a complete handover. Restore creates or resumes this exact archive in a separate private directory.</p><pre>openfema restore --archive OpenFEMA_Complete_Workspace.zip --workspace /absolute/private/restored-workspace\nopenfema-workspace --workspace /absolute/private/restored-workspace</pre>'+(S.view.restoredFrom?'<h4>Received workspace</h4><pre>'+esc(JSON.stringify(S.view.restoredFrom,null,2))+'</pre>':'')+'</section><section class="panel"><h3>Current portfolio deliverables</h3>'+(v?'<p>'+esc(v.criteria.name)+' · version '+v.number+'</p><div class="files">'+button('export','Complete standalone report','data-format="html"')+button('export','All original portfolio rows and reviews','data-format="json"')+button('export','Current table for spreadsheets','data-format="csv"')+button('source-export','Complete original source bundle','data-id="'+v.editionId+'"')+'</div>':empty('Select a saved version','Its complete report and original source become available here.'))+'</section></div>'+
    (exports?'<section class="panel"><h3>Saved exports</h3><div class="table-wrap"><table><thead><tr><th>File</th><th>Kind</th><th>Bytes</th><th>SHA-256</th><th>Receive</th></tr></thead><tbody>'+exports+'</tbody></table></div></section>':'')+
    (retained?'<section class="panel"><h3>Continue retained browser work</h3><p>These original requests remain available after an interrupted response. Continue opens the saved native outcome or resumes its original inputs.</p><div class="table-wrap"><table><thead><tr><th>Operation</th><th>Action</th><th>Saved</th><th>Original inputs</th><th>Continue</th></tr></thead><tbody>'+retained+'</tbody></table></div></section>':'')+
    (legacy?'<details><summary>Earlier browser request</summary><p>This browser also retains a request saved before workspace identities were recorded. Download its complete original inputs for review and reopening in the intended workspace.</p>'+button('download-earlier-request','Download original request')+'</details>':'')+
    '<details><summary>Original operation history</summary><p class="small">A repeated operation ID reopens its saved outcome. Retained records include the original inputs, result and error for interrupted work.</p><div class="table-wrap"><table><thead><tr><th>Operation</th><th>Action</th><th>State</th><th>Updated</th><th>Open</th></tr></thead><tbody>'+ops+'</tbody></table></div></details>';
}

function openDialog(name,html,{record=false}={}){if(!record){S.detail=null;S.detailGeneration++;}$('#record-title').textContent=name;$('#record-body').innerHTML=html;const dialog=$('#record-dialog');if(!dialog.open)dialog.showModal();}
async function openRecord(table,row){
  const selectedVersion=version(),selectedPortfolio=portfolio(),section=S.section,generation=++S.detailGeneration;
  if(!selectedVersion||!selectedPortfolio||!row)throw new Error('Select an original row from the current saved version.');
  S.detail=null;
  const current=()=>generation===S.detailGeneration&&version()?.id===selectedVersion.id&&portfolio()?.id===selectedPortfolio.id&&S.section===section;
  if(table==='categories'){openDialog('Work category '+row.category,'<pre>'+esc(JSON.stringify(row,null,2))+'</pre>');return;}
  if(table==='issues'){
    const subject=row.subject;
    if(subject.startsWith('project:')){table='projects';row={id:subject.slice(8)};}
    else if(subject.startsWith('declaration:')){table='declarations';row={id:subject.slice(12)};}
    else if(subject.startsWith('applicant-source:')){table='applicants';row={id:subject.slice(17)};}
    else if(subject.startsWith('applicant:')){table='applicants';row={id:subject.slice(10)};}
    else if(subject.startsWith('disaster:')){table='disasters';row={id:subject.slice(9)};}
    else{openDialog('Original source issue','<pre>'+esc(JSON.stringify(row,null,2))+'</pre>');return;}
  }
  const record=await api('/api/detail?'+new URLSearchParams({versionId:selectedVersion.id,table,id:row.id||row.subject||row.key||row.disasterNumber}));
  if(!current())return;
  let applicantRecord=table==='applicants'?record:null;
  if(table==='projects')try{applicantRecord=await api('/api/detail?'+new URLSearchParams({versionId:selectedVersion.id,table:'applicants',id:record.key}));}catch{}
  if(!current())return;
  S.detail={table,record,versionId:selectedVersion.id,portfolioId:selectedPortfolio.id};
  const pairs=Object.entries(record).filter(([k,v])=>!['subject','sourceUrl','sourcePageSha256'].includes(k)&&v!==null&&typeof v!=='object');
  let html='<dl class="record-summary">'+pairs.map(([k,v])=>'<div><dt>'+esc(title(k))+'</dt><dd>'+esc(v)+'</dd></div>').join('')+'</dl>';
  for(const key of ['projectCost','federalObligated','totalObligated','mitigation'])if(record[key])html+='<p class="checkline"><strong>'+title(key)+'</strong>'+esc(record[key].decimal??record[key].state)+' USD <span class="muted small">· original '+esc(String(record[key].raw))+'</span></p>';
  const a=record.annotation||{},sources=applicantRecord?.sources||[];
  if(portfolio().currentVersionId===selectedVersion.id&&record.subject){
    html+='<section class="panel"><h3>Record an analyst decision</h3><form id="review-form"><div class="grid three"><div><label for="review-status">Status</label><select id="review-status" name="status">'+S.schema.reviewStates.map(k=>'<option value="'+k+'"'+((a.status||'open')===k?' selected':'')+'>'+title(k.replace('_',' '))+'</option>').join('')+'</select></div><div><label for="review-disposition">Portfolio treatment</label><select id="review-disposition" name="disposition"><option value="include"'+(a.disposition!=='exclude'?' selected':'')+'>Include</option><option value="exclude"'+(a.disposition==='exclude'?' selected':'')+'>Exclude from totals</option></select></div><div><label for="review-priority">Priority</label><select id="review-priority" name="priority">'+['low','normal','high'].map(k=>'<option value="'+k+'"'+((a.priority||'normal')===k?' selected':'')+'>'+title(k)+'</option>').join('')+'</select></div>'+input('review-owner','Review owner',a.owner||'')+input('review-due','Follow-up date',a.dueDate||'','date')+
      (sources.length?'<div><label for="review-applicant">Original applicant match</label><select id="review-applicant" name="applicantSourceId">'+options(sources.map(s=>({value:s.id,label:(s.original.applicantName||s.id)+' · '+short(s.id)})),a.applicantSourceId||record.selectedApplicantSourceId||'','Keep source matching')+'</select></div>':'')+area('review-note','Decision and source context',a.note||'','class="span4"')+'</div><div class="actions"><button class="primary" type="submit">Save review as a new version</button></div></form></section>';
  }
  if(record.original)html+='<details open><summary>Original '+table+' record</summary><pre>'+esc(JSON.stringify(record.original,null,2))+'</pre><p class="small mono">Page '+esc(record.sourcePageSha256)+' · original zero-based row '+esc(record.sourceRow)+'</p><div class="actions">'+button('download','Complete original page','data-path="/api/objects/'+record.sourcePageSha256+'"')+'</div></details>';
  if(sources.length)html+='<details><summary>Original applicant source records · '+sources.length+'</summary>'+sources.map(s=>'<article class="record-source"><h4>'+esc(s.original.applicantName||s.id)+'</h4><p class="small mono">'+esc(s.id)+' · row '+s.sourceRow+'</p><pre>'+esc(JSON.stringify(s.original,null,2))+'</pre>'+button('download','Complete original page','data-path="/api/objects/'+s.sourcePageSha256+'"')+'</article>').join('')+'</details>';
  if(record.alternatives?.length)html+='<details open><summary>Conflicting original alternatives</summary><pre>'+esc(JSON.stringify(record.alternatives,null,2))+'</pre></details>';
  if(record.relatedReviews?.length)html+='<details><summary>Related project, applicant and disaster reviews</summary><pre>'+esc(JSON.stringify(record.relatedReviews,null,2))+'</pre></details>';
  openDialog(record.projectTitle||record.name||record.title||title(table)+' '+(record.id||record.disasterNumber||''),html,{record:true});
}
async function refresh({repaint=true}={}){
  const view=await api('/api/view');
  if(view.workspaceId!==S.schema.workspaceId)throw new Error('The refreshed view belongs to another original workspace.');
  if(!Number.isSafeInteger(view.revision)||view.revision<0)throw new Error('The original workspace revision is incomplete.');
  if(view.revision>=S.view.revision)S.view=view;
  updateHeader();if(repaint)render();return S.view;
}
function criteria(form){
  const get=name=>form.get(name)||'';
  return {name:get('portfolio-name'),states:split(get('portfolio-states')).map(x=>x.toUpperCase()),disasters:split(get('portfolio-disasters')),applicants:split(get('portfolio-applicants')),counties:split(get('portfolio-counties')),categories:split(get('portfolio-categories')),declarationFrom:get('portfolio-from'),declarationTo:get('portfolio-to'),minimumFederal:get('portfolio-min'),maximumFederal:get('portfolio-max'),includeUnjoined:form.has('portfolio-unjoined'),note:get('portfolio-note')};
}
async function executeCommand(target){
  const command=target.dataset.command,id=target.dataset.id;
  if(command==='section'){S.detail=null;S.detailGeneration++;S.section=target.dataset.section;S.offset=0;S.search='';S.sort='';render();return;}
  if(command==='table'){S.detail=null;S.detailGeneration++;S.table=target.dataset.table;S.offset=0;S.search='';S.sort='';render();return;}
  if(command==='previous'||command==='next'){S.offset=command==='previous'?Math.max(0,S.offset-100):S.rows?.nextOffset??S.offset;await loadRows();return;}
  if(command==='new-portfolio'){S.section='portfolios';render();$('#portfolio-editor').open=true;if(target.dataset.edition)$('#portfolio-edition').value=target.dataset.edition;$('#portfolio-name').focus();return;}
  if(command==='record'){
    if(!S.rows||S.rows.table!==target.dataset.table||!S.rows.rows[Number(target.dataset.row)])throw new Error('Open a row from the currently loaded table.');
    await openRecord(target.dataset.table,S.rows.rows[Number(target.dataset.row)]);return;
  }
  if(command==='download'){await download(target.dataset.path);return;}
  if(command==='pause-capture'||command==='resume-capture'){await act(command==='pause-capture'?'source.pause':'source.resume',{captureId:id});render();notify(command==='pause-capture'?'Capture paused with original pages retained.':'Continuing the original capture.');return;}
  if(command==='edition'){
    const e=await api('/api/edition?editionId='+encodeURIComponent(id));let html='<p class="small mono">'+esc(e.id)+'</p><pre>'+esc(JSON.stringify({scope:e.scope,completedAt:e.completedAt,consistency:e.consistency,issues:e.issues},null,2))+'</pre>';
    for(const [kind,d]of Object.entries(e.datasets)){html+='<h3>'+title(kind)+' · '+number(d.rowCount)+' original rows</h3><p>'+esc(d.entity)+' v'+esc(d.version)+' · '+number(d.pages.length)+' retained pages</p><div class="actions">'+['metadataReceipt','fieldsReceipt','metadataEndReceipt'].filter(k=>d[k]?.sha256).map(k=>button('download',title(k),'data-path="/api/objects/'+d[k].sha256+'"')).join('')+'</div><details><summary>Complete original page manifest</summary><pre>'+esc(JSON.stringify(d,null,2))+'</pre></details>';}
    openDialog('Source edition',html);return;
  }
  if(command==='source-export'){const r=await act('source.export',{editionId:id});await download(r.downloadUrl);render();return;}
  if(command==='export'){if(!version())throw new Error('Select a saved portfolio version.');const r=await act('export.create',{versionId:version().id,table:S.table,format:target.dataset.format});await download(r.downloadUrl);render();return;}
  if(command==='workspace-export'){const r=await act('workspace.export',{});await download(r.downloadUrl);render();return;}
  if(command==='query-dataset'){S.section='publication';render();$('#query-panel').open=true;$('#query-dataset').value=id;$('#dataset-query').focus();return;}
  if(command==='choose-dataset'){S.section='publication';render();$('#release-panel').open=true;$('#release-dataset').value=id;$('#release-origin').focus();return;}
  if(command.startsWith('release-')){
    if(command==='release-reprepare'){
      const terms=await api('/api/release-terms?releaseId='+encodeURIComponent(id));const r=await act('release.prepare',{datasetId:terms.datasetId,origin:terms.origin,path:terms.path,payment:terms.payment});S.releaseStates[r.id]={release:r.release,publisher:r.publisher,selection:r.selection};render();notify('Prepared '+r.id+' from the original dataset and public terms at this workspace location.');return;
    }
    if(command==='release-inspect'){S.releaseStates[id]=await act('release.inspect',{releaseId:id});render();return;}
    const current=await act('release.inspect',{releaseId:id});S.releaseStates[id]=current;
    const r=await act('release.'+command.slice(8),{releaseId:id,...(command==='release-stop'?{}:{expectedGeneration:current.selection.generation})});S.releaseStates[id]=r;render();notify('Original release operation completed: '+command.slice(8)+'.');return;
  }
  if(command==='operation'){
    const op=await api('/api/operation?operationId='+encodeURIComponent(id));
    if(!op||op.operationId!==id)throw new Error('Choose an original operation from this workspace.');
    openDialog('Original operation','<pre>'+esc(JSON.stringify(op,null,2))+'</pre><div class="actions">'+button('resume-operation','Continue original operation','data-id="'+esc(id)+'"',true)+'</div>');return;
  }
  if(command==='resume-operation'){await resumeOperation(id);return;}
  if(command==='retry'){if(!S.pending)throw new Error('The original request is no longer selected.');await resumeOperation(S.pending.operationId);return;}
  if(command==='download-earlier-request'){
    const original=sessionStorage.getItem('openfema-pending');if(original===null)throw new Error('The earlier request is no longer available in this browser.');
    const url=URL.createObjectURL(new Blob([original],{type:'application/json;charset=utf-8'})),a=document.createElement('a');
    a.href=url;a.download='OpenFEMA_Earlier_Browser_Request.json';document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),60000);return;
  }
}
async function submitForm(event){
  const form=event.target,data=new FormData(form),id=form.id,submitter=event.submitter?.value;
  if(id==='table-form'){S.search=String(data.get('search')||'');S.sort=String(data.get('sort')||'');S.direction=String(data.get('direction')||'asc');S.offset=0;await loadRows();return;}
  if(id==='capture-form'){
    const disasters=split(data.get('capture-disasters'));if(disasters.some(v=>!(/^[1-9]\d*$/.test(v))))throw new Error('Enter positive disaster numbers separated by commas.');
    const scope={pageSize:Number(data.get('capture-page-size')||1000)};
    if(disasters.length)scope.disasterNumbers=disasters.map(Number);const states=split(data.get('capture-states')).map(x=>x.toUpperCase());if(states.length)scope.states=states;
    if(data.get('capture-from'))scope.declarationDateFrom=data.get('capture-from');if(data.get('capture-to'))scope.declarationDateTo=data.get('capture-to');
    await act('source.capture',{scope,label:String(data.get('capture-label')||'Public Assistance source')});render();notify('The full selected source cohort is being captured.');return;
  }
  if(id==='import-form'){
    const file=$('#source-file').files[0];if(!file)throw new Error('Choose the original source bundle.');
    const bundle=await readSourceFile(file),identity=await bundleIdentity(bundle);
    const candidates=[...(S.pending?[S.pending]:[]),...retainedRequests()];
    const retained=candidates.find(r=>r.action==='source.import'&&r.originalSource?.sha256===identity.sha256&&r.originalSource?.bytes===identity.bytes);
    const request=retained?await originalRequest(retained.operationId,{sourceBundle:bundle}):null;
    await act('source.import',{bundle},request);render();notify('Complete original source received'+(request?' through '+request.operationId:'')+'.');return;
  }
  if(id==='portfolio-form'){
    const spec=criteria(data),editionId=String(data.get('portfolio-edition')||'');if(!editionId)throw new Error('Select a complete retained source edition.');
    await act(submitter==='revise'?'portfolio.revise':'portfolio.create',submitter==='revise'?{portfolioId:portfolio().id,expectedVersion:version().id,editionId,criteria:spec}:{name:spec.name,editionId,criteria:spec});S.offset=0;S.table='projects';render();notify('Saved the complete portfolio version.');return;
  }
  if(id==='review-form'){
    const selection=S.detail;
    if(!selection||selection.versionId!==version()?.id||selection.portfolioId!==portfolio()?.id||
      portfolio().currentVersionId!==selection.versionId)throw new Error('Open the original record in the currently selected version before saving its review.');
    await act('review.save',{portfolioId:selection.portfolioId,versionId:selection.versionId,annotation:{subject:selection.record.subject,status:String(data.get('status')),disposition:String(data.get('disposition')),priority:String(data.get('priority')),owner:String(data.get('review-owner')||''),dueDate:String(data.get('review-due')||''),applicantSourceId:String(data.get('applicantSourceId')||''),note:String(data.get('review-note')||'')}});
    $('#record-dialog').close();S.detail=null;render();notify('Analyst decision saved in a new portfolio version.');return;
  }
  if(id==='accept-form'){await act('review.accept',{portfolioId:portfolio().id,versionId:version().id,note:String(data.get('accept-note')||'')});render();notify('Acceptance note saved for this exact version.');return;}
  if(id==='compare-form'){S.comparison=await act('portfolio.compare',{beforeVersionId:String(data.get('before')),afterVersionId:String(data.get('after'))});render();return;}
  if(id==='dataset-form'){await act('dataset.prepare',{versionId:version().id,table:String(data.get('table')||'projects'),name:String(data.get('dataset-name')||version().criteria.name)});render();notify('Native dataset and complete source package prepared.');return;}
  if(id==='query-form'){const datasetId=String(data.get('dataset'));S.query={datasetId,result:await act('dataset.query',{datasetId,query:String(data.get('dataset-query')||'')})};render();$('#query-panel').open=true;return;}
  if(id==='release-form'){const r=await act('release.prepare',{datasetId:String(data.get('dataset')),origin:String(data.get('release-origin')),path:String(data.get('release-path')),payment:JSON.parse(String(data.get('release-payment')))});S.releaseStates[r.id]={release:r.release,publisher:r.publisher,selection:r.selection};render();notify('Original merchant release staged.');return;}
  if(id==='buyer-form'){const intentIds=split(data.get('buyer-intents'));S.buyer=await act(submitter==='receive'?'buyer.receive':'buyer.inspect',{intentIds});render();notify(submitter==='receive'?'Complete original customer dataset received.':'Original buyer selection inspected.');return;}
}
document.addEventListener('click',event=>{const target=event.target.closest('button[data-command]');if(target){void executeCommand(target).catch(error=>notify(error.message,true));}});
document.addEventListener('submit',event=>{if(event.target.matches('form')){event.preventDefault();void submitForm(event).catch(error=>notify(error.message,true));}});
$('#selection').addEventListener('change',event=>{
  if(!['selected-portfolio','selected-version'].includes(event.target.id)||!event.target.value)return;
  S.detail=null;S.detailGeneration++;S.rowGeneration++;if($('#record-dialog').open)$('#record-dialog').close();
  const portfolioId=event.target.id==='selected-portfolio'?event.target.value:portfolio().id;
  const versionId=event.target.id==='selected-version'?event.target.value:undefined;
  void act('portfolio.select',{portfolioId,...(versionId?{versionId}:{})}).then(()=>{S.offset=0;render();}).catch(error=>{render();notify(error.message,true);});
});
$('#close-record').addEventListener('click',()=>{S.detail=null;S.detailGeneration++;$('#record-dialog').close();});
$('#record-dialog').addEventListener('close',()=>{S.detail=null;S.detailGeneration++;});
$('#refresh').addEventListener('click',()=>{void refresh().catch(error=>notify(error.message,true));});
async function start(){
  if(!token)throw new Error('Open the private session URL printed by openfema-workspace.');
  [S.schema,S.view]=await Promise.all([api('/api/schema'),api('/api/view')]);
  if(!S.view.workspaceId||S.schema.workspaceId!==S.view.workspaceId)throw new Error('Open the schema and state of the same original workspace.');
  S.pending=retainedRequests()[0]??null;render();if(S.pending)notify('An original browser operation is retained. Use Handover to inspect it, or reopen its original request.',true);
  setInterval(()=>{if(S.busy||document.hidden)return;const editing=['INPUT','TEXTAREA','SELECT'].includes(document.activeElement?.tagName)||$('#record-dialog').open;
    if(S.view?.captures.some(c=>['RUNNING','IMPORTING'].includes(c.state)))void refresh({repaint:S.section==='sources'&&!editing}).catch(error=>notify(error.message,true));},4000);
}
void start().catch(error=>{$('#connection').textContent='Session unavailable';notify(error.message,true);$('#main').innerHTML=empty('Open the original workspace session','Use the private URL printed by the installed OpenFEMA command.');});
