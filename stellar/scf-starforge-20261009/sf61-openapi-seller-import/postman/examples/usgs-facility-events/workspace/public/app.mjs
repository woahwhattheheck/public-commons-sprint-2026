// MIT. Complete customer operating workflow over the retained original reporter.
const $=selector=>document.querySelector(selector),all=selector=>[...document.querySelectorAll(selector)];
const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const uid=()=>crypto.randomUUID(),clone=value=>JSON.parse(JSON.stringify(value));
const label=value=>String(value??'').replaceAll('-',' ');
const stamp=value=>value?String(value).replace('T',' ').replace(/\.000Z$/,' UTC').replace(/Z$/,' UTC'):'—';
const short=value=>String(value??'').slice(0,12);
const count=value=>Number(value??0).toLocaleString('en-GB');
const option=(value,title,chosen=false)=>'<option value="'+escape(value)+'"'+(chosen?' selected':'')+'>'+escape(title)+'</option>';
const empty=text=>'<div class="empty">'+escape(text)+'</div>';
const stat=(number,title)=>'<div class="stat"><strong>'+escape(number)+'</strong><span>'+escape(title)+'</span></div>';
const badge=value=>'<span class="badge'+(value==='needs-review'?' strong':'')+'">'+escape(label(value))+'</span>';
const field=(name,title,value='',type='text',attrs='')=>'<label>'+escape(title)+'<input name="'+name+'" type="'+type+'" value="'+escape(value??'')+'" '+attrs+'></label>';
const area=(name,title,value='',maximum=8000,rows=4)=>'<label>'+escape(title)+'<textarea name="'+name+'" maxlength="'+maximum+'" rows="'+rows+'">'+escape(value)+'</textarea></label>';
const utcValue=value=>value?value.replace(/Z$/,''):'';
const utc=value=>value?new Date(value+'Z').toISOString():null;
const safeUrl=value=>{try{const u=new URL(value);return ['https:','http:'].includes(u.protocol)&&!u.username&&!u.password?u.href:null;}catch{return null;}};
const external=(value,title)=>{const url=safeUrl(value);return url?'<a href="'+escape(url)+'" target="_blank" rel="noopener noreferrer">'+escape(title??value)+'</a>':escape(title??value);};
let token=location.hash.slice(1),info={projects:[]},projectId=null,state=null,page='overview',busy=false;
let chosenSources=new Set(),rosterDraft=null,siteIndex=0,sourceOffset=0,workResult=null,comparison=null;
let workFilter={edition:'',status:'',assignee:'',q:'',open:true,offset:0},comparisonSelection={before:'',after:''},comparisonOffset=0;
let currentReview=null,historyLimit=50,pollTimer=null;
const drafts=new Map(),fileDrafts=new Map(),rosterDrafts=new Map(),pendingOperations=new Map();
function notice(message,error=false){const box=$('#notice');box.textContent=message;box.classList.toggle('error',error);}
function controls(){
  for(const node of all('button,input,select,textarea'))node.disabled=busy||node.dataset.unavailable==='true';
  $('#main').setAttribute('aria-busy',String(busy));
}
function values(form){
  const result={};
  for(const node of form.elements){
    if(!node.name||node.type==='file'||node.type==='submit'||node.type==='button')continue;
    if(node.type==='radio'){if(node.checked)result[node.name]=node.value;}
    else if(node.type==='checkbox')result[node.name]=node.checked;
    else if(node.multiple)result[node.name]=[...node.selectedOptions].map(option=>option.value);
    else result[node.name]=node.value;
  }
  return result;
}
function fill(form,input){
  if(!form||!input)return;
  for(const node of form.elements){
    if(!node.name||!(node.name in input)||node.type==='file')continue;
    if(node.type==='checkbox')node.checked=Boolean(input[node.name]);
    else if(node.type==='radio')node.checked=node.value===input[node.name];
    else if(node.multiple)for(const option of node.options)option.selected=input[node.name].includes(option.value);
    else node.value=input[node.name]??'';
  }
}
const draftKey=form=>String(projectId??'workspace')+':'+form.id;
function remember(form){if(form?.id)drafts.set(draftKey(form),values(form));}
function operationKey(control){
  const id=control.id||control.dataset.action+':'+(control.dataset.id??'');
  return (['new-project-form','receive-form','historical-example:'].includes(id)?'@workspace':String(projectId))+':'+id;
}
function clearOperation(control){pendingOperations.delete(operationKey(control));delete control.dataset.operationId;}
function clearDraft(form){drafts.delete(draftKey(form));clearOperation(form);}
function operation(control){
  const key=operationKey(control),id=pendingOperations.get(key)||control.dataset.operationId||uid();
  pendingOperations.set(key,id);control.dataset.operationId=id;return id;
}
async function api(path,{method='GET',data,body,headers={}}={}){
  const response=await fetch(path,{method,headers:{'X-Workspace-Token':token,...(data!==undefined?{'Content-Type':'application/json'}:{}),...headers},body:data!==undefined?JSON.stringify(data):body});
  const text=await response.text();let result;try{result=JSON.parse(text);}catch{throw new Error('The workspace response was interrupted. Retain this draft and retry the same operation.');}
  if(!response.ok)throw Object.assign(new Error(result.error??'The workspace request failed.'),{status:response.status,code:result.code});
  if(state&&result.projectId===projectId&&Number.isInteger(result.revision))state.project.revision=Math.max(state.project.revision,result.revision);
  return result;
}
const route=suffix=>'/api/projects/'+encodeURIComponent(projectId)+(suffix?'/'+suffix:'');
function downloadUrl(suffix,query={}){
  const url=new URL(route(suffix),location.origin);
  for(const [key,value] of Object.entries(query))if(value!==null&&value!==undefined&&value!=='')url.searchParams.set(key,String(value));
  url.searchParams.set('token',token);return url.pathname+url.search;
}
function fileLink(suffix,title,query={},blank=false){return '<a href="'+escape(downloadUrl(suffix,query))+'"'+(blank?' target="_blank" rel="noopener"':'')+'>'+escape(title)+'</a>';}
function smallDownload(name,text,type='application/json'){
  const url=URL.createObjectURL(new Blob([text],{type})),anchor=document.createElement('a');
  anchor.href=url;anchor.download=name;document.body.append(anchor);anchor.click();anchor.remove();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
async function refresh(){
  if(!projectId)return;
  const id=projectId,result=await api('/api/projects/'+encodeURIComponent(id));
  if(id===projectId)state=result;
}
async function refreshInfo(){info=await api('/api/info');}
async function act(message,fn){
  if(busy)return;
  busy=true;controls();notice(message);
  try{await fn();if($('#notice').textContent===message)notice('Saved.');}
  catch(error){if(error.status===409&&projectId)await refresh().catch(()=>{});notice(error.message,true);}
  finally{busy=false;controls();schedulePoll();}
}
function pageHead(title,description,actions=''){return '<div class="page-head"><div><h1>'+escape(title)+'</h1><p>'+escape(description)+'</p></div>'+(actions?'<div class="actions">'+actions+'</div>':'')+'</div>';}
function selectedEdition(){return state?.editions.find(item=>item.id===state.project.selectedEditionId)??null;}
function rosterName(id){return state?.rosters.find(item=>item.id===id)?.label??short(id);}
function render(){
  $('#project-select').innerHTML=info.projects.length?info.projects.map(item=>option(item.id,item.title,item.id===projectId)).join(''):option('','Choose or create a project',true);
  for(const item of all('[data-page]'))item.setAttribute('aria-current',item.dataset.page===page?'page':'false');
  $('#workspace-note').textContent=state?'Revision '+state.project.revision+'\n'+state.project.title:'Private local workspace';
  if(!state){$('#main').innerHTML=pageHead('Facility operations','Keep original event sources, saved facility reports and operating decisions in one customer workspace.')+
    '<div class="panel"><h2>Start a customer project</h2><p>Set up the facilities and their review thresholds, receive an original response or capture a public USGS window, then assign and record the site work.</p><div class="actions"><button data-action="new-project" class="primary">New project</button><button data-action="receive">Receive a complete handover</button></div></div>';controls();return;}
  const views={overview:overviewPage,facilities:facilitiesPage,sources:sourcesPage,editions:editionsPage,work:workPage,delivery:deliveryPage};
  $('#main').innerHTML=views[page]();
  for(const form of all('#main form')){fill(form,drafts.get(draftKey(form)));for(const input of [...form.elements].filter(node=>node.type==='file')){const saved=fileDrafts.get(draftKey(form)+':'+input.name);if(saved?.length){const transfer=new DataTransfer();for(const file of saved)transfer.items.add(file);input.files=transfer.files;}}}
  if(page==='sources'){queryVisibility();sourcePieces();}
  if(page==='facilities')renderFacilityEditor();
  if(page==='work')renderWork();
  if(page==='editions')renderComparison();
  controls();
}
function overviewPage(){
  const project=state.project,sites=state.rosters.find(item=>item.id===project.currentRosterId),edition=selectedEdition();
  return pageHead(project.title,project.organisation||'Customer facilities, retained source windows and attributed operating work.')+
    '<div class="stats">'+stat(count(sites?.facilityInput.facilities.length),'Current facilities')+stat(count(state.sources.length),'Retained source responses')+stat(count(state.editions.length),'Saved report editions')+stat(count(edition?.counts.facilityEventMatches),'Matches in selected edition')+'</div>'+
    '<div class="two-column"><section class="panel"><h2>Current operating edition</h2>'+(edition?'<p><strong>'+escape(edition.label)+'</strong><br>'+escape(stamp(edition.createdAt))+' · '+escape(edition.operator)+'</p><dl><dt>Facility roster</dt><dd>'+escape(rosterName(edition.rosterId))+'</dd><dt>Source responses</dt><dd>'+edition.sourceIds.length+'</dd><dt>Original event rows</dt><dd>'+count(edition.counts.receivedFeatures)+'</dd><dt>Facilities with matches</dt><dd>'+count(edition.counts.facilitiesWithMatches)+'</dd></dl><div class="actions"><button data-page="work">Open operating queue</button>'+fileLink('editions/'+edition.id+'/handover.html','Open customer handover',{},true)+'</div>':empty('Save a facility roster, select source responses and prepare the first report edition.'))+
    '</section><section class="panel"><h2>Work across source windows</h2><p>The operating queue retains every observed facility/event pair. Assignments remain available when a later source window no longer includes an event.</p><p>Each review names its operator and the exact event and facility selection. Revised source values return the item to review while preserving the preceding action and attribution.</p><div class="actions"><button data-page="facilities">Manage facilities</button><button data-page="sources">Receive event sources</button></div></section></div>'+
    '<section class="panel"><h2>Project and operating procedure</h2><form id="settings-form"><div class="grid">'+field('title','Project title',project.title,'text','maxlength="200" required')+field('organisation','Organisation',project.organisation,'text','maxlength="300"')+
    field('operator','Default operator name',project.operator,'text','maxlength="200"')+area('handoverContact','Handover contact',project.handoverContact,1000,2)+'</div>'+area('procedure','Operating procedure',project.procedure,12000,6)+
    '<div class="actions"><button type="submit" class="primary">Save project settings</button></div></form></section>'+
    (project.importedFrom?'<section class="panel"><h2>Received work</h2><dl><dt>Original project</dt><dd class="mono">'+escape(project.importedFrom.projectId)+'</dd><dt>Original revision</dt><dd>'+escape(project.importedFrom.revision)+'</dd><dt>Handover SHA-256</dt><dd class="mono">'+escape(project.importedFrom.sha256)+'</dd></dl><p>Continue the received work here. The full export retains its original receiving header and attributed history.</p></section>':'');
}
function initialRoster(){
  const saved=state.rosters.find(value=>value.id===state.project.currentRosterId);
  return saved?clone({label:saved.label,facilityInput:saved.facilityInput,details:saved.details}):{label:'Operating facilities',facilityInput:{schema:'commons.facility-watch-input.v1',description:'',facilities:[]},details:{}};
}
function facilitiesPage(){
  if(!rosterDraft)rosterDraft=initialRoster();
  const sites=rosterDraft.facilityInput.facilities;
  return pageHead('Facilities','Save a new roster edition when site coordinates, thresholds, contacts or procedures change.')+
    '<section class="panel"><div class="grid">'+field('rosterLabel','Roster name',rosterDraft.label,'text','id="roster-label" maxlength="200" required')+field('rosterDescription','Roster description',rosterDraft.facilityInput.description??'','text','id="roster-description" maxlength="4000"')+'</div>'+
    '<div class="actions"><button data-action="save-roster" class="primary"'+(!sites.length?' data-unavailable="true"':'')+'>Save roster edition</button><button data-action="add-facility">Add facility</button><button data-action="roster-json">Download draft JSON</button><button data-action="roster-csv">Download draft CSV</button></div>'+
    '<p class="hint">Stable facility IDs keep operating assignments attached across roster editions. Latitude and longitude use decimal degrees; radius is in kilometres.</p></section>'+
    '<div class="facility-editor"><section class="panel"><h2>Facility roster <span class="muted">('+sites.length+' / 500)</span></h2>'+(!sites.length?empty('Add a facility or open an existing roster below.'):'<div class="table-wrap"><table><thead><tr><th>Facility</th><th>Coordinates</th><th class="numeric">Radius / floor</th><th>Contact</th><th>Open</th></tr></thead><tbody>'+sites.map((site,index)=>'<tr'+(index===siteIndex?' class="selected-row"':'')+'><td>'+escape(site.name||'New facility')+'<small>'+escape(site.id)+'</small></td><td>'+escape(site.latitude)+'<br>'+escape(site.longitude)+'</td><td class="numeric">'+escape(site.radiusKm)+' km<br>M '+escape(site.minimumMagnitude)+'</td><td>'+escape(rosterDraft.details[site.id]?.owner??'')+'</td><td><button data-action="edit-facility" data-index="'+index+'">Edit</button></td></tr>').join('')+'</tbody></table></div>')+
    '<details><summary>Open a roster file</summary><form id="roster-import-form"><label>Original JSON or CSV roster<input name="file" type="file" accept=".json,.csv" required></label><div class="actions"><button type="submit">Open as a roster draft</button></div></form><p class="hint">CSV columns: id, name, latitude, longitude, radiusKm, minimumMagnitude, owner, procedure, notes.</p></details>'+
    '<details><summary>Saved roster editions</summary>'+(state.rosters.length?state.rosters.slice().reverse().map(item=>'<p><button data-action="open-roster" data-id="'+escape(item.id)+'">'+escape(item.label)+'</button><br><small>'+escape(stamp(item.createdAt))+' · '+item.facilityInput.facilities.length+' facilities</small></p>').join(''):empty('The first saved roster will appear here.'))+'</details></section><section class="panel" id="facility-editor"></section></div>';
}
function renderFacilityEditor(){
  const box=$('#facility-editor');if(!box)return;
  const sites=rosterDraft.facilityInput.facilities;
  siteIndex=Math.max(0,Math.min(siteIndex,sites.length-1));const site=sites[siteIndex];
  if(!site){box.innerHTML='<h2>Facility details</h2>'+empty('Choose or add a facility to record its operating details.');return;}
  const detail=rosterDraft.details[site.id]??{};
  box.innerHTML='<h2>'+escape(site.name||'New facility')+'</h2><form id="facility-editor-form"><div class="grid">'+
    field('id','Stable facility ID',site.id,'text','maxlength="100" pattern="[A-Za-z0-9][A-Za-z0-9._-]{0,99}" required')+
    field('name','Facility name',site.name,'text','maxlength="300" required')+
    field('latitude','Latitude',site.latitude,'number','min="-90" max="90" step="any" required')+
    field('longitude','Longitude',site.longitude,'number','min="-180" max="180" step="any" required')+
    field('radiusKm','Review radius (km)',site.radiusKm,'number','min="0.001" max="20002" step="any" required')+
    field('minimumMagnitude','Minimum magnitude',site.minimumMagnitude,'number','min="-10" max="10" step="any" required')+
    '</div>'+field('owner','Site contact / owner',detail.owner??'','text','maxlength="200"')+area('procedure','Site operating procedure',detail.procedure??'',8000,5)+area('notes','Site notes',detail.notes??'',4000,3)+
    '<div class="actions"><button type="submit">Apply to roster draft</button><button type="button" data-action="remove-facility">Remove from next roster</button></div><p class="hint">Save the roster edition to use these details in a report. Earlier editions remain available.</p></form>';
}
function takeFacility(){
  const form=$('#facility-editor-form');if(!form)return;
  const input=values(form),previous=rosterDraft.facilityInput.facilities[siteIndex];if(!previous)return;
  const next={id:input.id,name:input.name,latitude:input.latitude,longitude:input.longitude,radiusKm:input.radiusKm,minimumMagnitude:input.minimumMagnitude};
  if(rosterDraft.facilityInput.facilities.some((site,index)=>index!==siteIndex&&site.id===next.id))throw new Error('This stable facility ID already belongs to another site in the roster.');
  if(previous.id!==next.id)delete rosterDraft.details[previous.id];
  rosterDraft.facilityInput.facilities[siteIndex]=next;
  rosterDraft.details[next.id]={owner:input.owner,procedure:input.procedure,notes:input.notes};
}
function takeRoster(){
  takeFacility();
  if($('#roster-label'))rosterDraft.label=$('#roster-label').value;
  if($('#roster-description'))rosterDraft.facilityInput.description=$('#roster-description').value;
  const value=clone(rosterDraft);
  for(const site of value.facilityInput.facilities)for(const key of ['latitude','longitude','radiusKm','minimumMagnitude']){
    if(site[key]===null||String(site[key]).trim()==='')throw new Error((site.name||'The facility')+' requires '+key+'.');
    site[key]=Number(site[key]);if(!Number.isFinite(site[key]))throw new Error('Enter a numeric '+key+' for '+(site.name||'the facility')+'.');
  }
  return value;
}
function defaultQuery(){
  return {label:'USGS day watch',mode:'feed',magnitude:'2.5',period:'day',starttime:'',endtime:'',minmagnitude:'4',bounded:false,minlatitude:'',maxlatitude:'',minlongitude:'',maxlongitude:''};
}
function sourcesPage(){
  const q=defaultQuery();
  return pageHead('Event sources','Capture a published USGS feed or a fixed catalog window, or retain the original GeoJSON received through your existing merchant and buyer workflow.')+
    '<div class="two-column"><section class="panel"><h2>Public USGS source</h2><form id="query-form">'+field('label','Source name',q.label,'text','maxlength="200" required')+
    '<label>Source selection<select name="mode">'+option('feed','Published real-time feed',true)+option('catalog','Fixed catalog window')+'</select></label>'+
    '<div id="feed-fields" class="grid"><label>Published magnitude selection<select name="magnitude">'+['all','1.0','2.5','4.5','significant'].map(value=>option(value,value==='all'?'All earthquakes':value==='significant'?'Significant earthquakes':'Magnitude '+value+' and above',value==='2.5')).join('')+'</select></label><label>Published period<select name="period">'+['hour','day','week','month'].map(value=>option(value,'Past '+value,value==='day')).join('')+'</select></label></div>'+
    '<div id="catalog-fields" hidden><div class="grid">'+field('starttime','Window start (UTC)','','datetime-local','step="0.001"')+field('endtime','Window end (UTC)','','datetime-local','step="0.001"')+
    field('minmagnitude','Minimum magnitude','4','number','min="-10" max="10" step="any"')+'</div><label class="check"><input name="bounded" type="checkbox">Limit to a geographic rectangle</label><div id="bounds-fields" class="grid" hidden>'+
    field('minlatitude','Minimum latitude','','number','min="-90" max="90" step="any"')+field('maxlatitude','Maximum latitude','','number','min="-90" max="90" step="any"')+
    field('minlongitude','Minimum longitude','','number','min="-360" max="360" step="any"')+field('maxlongitude','Maximum longitude','','number','min="-360" max="360" step="any"')+'</div>'+
    '<p class="hint">USGS includes both time-window boundaries. Longitudes beyond ±180 support a rectangle across the date line. Retained count observations accompany each catalog response.</p></div>'+
    '<div class="actions"><button type="submit" class="primary">Capture source</button><button type="button" data-action="save-query">Save source selection</button><button type="button" data-action="napa-query">Use Napa historical window</button></div></form>'+
    '<details><summary>Saved source selections</summary>'+(state.queries.length?state.queries.slice().reverse().map(item=>'<p><button data-action="open-query" data-id="'+escape(item.id)+'">'+escape(item.plan.label)+'</button><br><small>'+escape(item.plan.mode==='feed'?item.plan.magnitude+' / '+item.plan.period:item.plan.starttime+' to '+item.plan.endtime)+'</small></p>').join(''):empty('Save a source selection to reuse its exact filters.'))+'</details></section>'+
    '<section class="panel"><h2>Receive original source files</h2><form id="source-import-form"><label>Original GeoJSON responses<input name="files" type="file" accept=".json,.geojson,.body" multiple required></label>'+
    '<label>Original HTTP status<select name="status">'+option('200','200 — GeoJSON response',true)+option('204','204 — original empty response body')+'</select></label>'+area('note','Source note','',4000,3)+
    '<div class="actions"><button type="submit">Retain selected response files</button></div></form><p class="hint">Each original response is retained byte for byte. Select up to 16 responses for one report edition.</p>'+
    '<details><summary>Original historical example</summary><p>The original source contains the 2014 South Napa earthquake and three illustrative city-centre sites. It provides a complete saved-report and receiving walkthrough.</p><div class="actions"><button data-action="historical-example">Open historical example project</button></div></details>'+
    '<p>'+external('https://earthquake.usgs.gov/fdsnws/event/1/','USGS event service')+' · '+external('https://earthquake.usgs.gov/earthquakes/feed/v1.0/geojson.php','Published GeoJSON feeds')+'</p></section></div>'+
    '<section class="panel"><div class="panel-title"><h2>Source captures</h2><button data-action="refresh-sources">Refresh capture progress</button></div><div id="capture-list"></div></section>'+
    '<section class="panel"><div class="panel-title"><h2>Retained response editions</h2><button data-page="editions">Prepare report from selected sources</button></div><p id="selected-source-count" class="hint"></p><div id="source-list"></div></section>';
}
function queryVisibility(){
  const form=$('#query-form');if(!form)return;
  const data=values(form),catalog=data.mode==='catalog';
  $('#feed-fields').hidden=catalog;$('#catalog-fields').hidden=!catalog;$('#bounds-fields').hidden=!data.bounded;
  for(const name of ['starttime','endtime','minmagnitude'])form.elements[name].required=catalog;
  for(const name of ['minlatitude','maxlatitude','minlongitude','maxlongitude'])form.elements[name].required=catalog&&data.bounded;
  for(const node of [...$('#feed-fields').querySelectorAll('input,select')])node.dataset.unavailable=String(catalog);
  for(const node of [...$('#catalog-fields').querySelectorAll('input,select')])node.dataset.unavailable=String(!catalog);
  for(const node of [...$('#bounds-fields').querySelectorAll('input')])node.dataset.unavailable=String(!catalog||!data.bounded);
}
function sourcePieces(){
  if(!$('#capture-list'))return;
  const captures=state.captures.slice().sort((a,b)=>b.createdAt.localeCompare(a.createdAt));
  $('#capture-list').innerHTML=captures.length?captures.map(job=>'<article class="capture"><h3>'+escape(job.plan.label)+' '+badge(job.state)+'</h3><p>'+job.completed.length+' retained responses · '+job.pending.length+' remaining intervals · '+job.observations.length+' original HTTP observations</p>'+
    (job.error?'<p><strong>'+escape(job.error)+'</strong></p>':'')+(job.retryAt?'<p>Source retry time: '+escape(stamp(job.retryAt))+'</p>':'')+
    '<div class="actions">'+(job.state==='capturing'?'<button data-action="pause-capture" data-id="'+job.id+'">Pause capture</button>':job.state!=='complete'?'<button data-action="resume-capture" data-id="'+job.id+'">Resume this capture</button>':'')+
    (job.sourceIds.length?'<button data-action="capture-sources" data-id="'+job.id+'">Use these '+job.sourceIds.length+' responses</button>':'')+'</div>'+
    '<details><summary>Original query and HTTP observations</summary><pre>'+escape(JSON.stringify(job.plan,null,2))+'</pre>'+job.observations.map(item=>'<p>'+escape(item.kind)+' · HTTP '+item.status+' · '+count(item.bytes)+' bytes · '+escape(stamp(item.receivedAt))+'<br>'+external(item.url,'Original USGS request')+' · '+fileLink('observations/'+job.id+'/'+item.id,'Download original response')+'<br><span class="mono">'+escape(item.bodySha256)+'</span></p>').join('')+'</details></article>').join(''):empty('Capture progress and retained HTTP observations will appear here.');
  $('#selected-source-count').textContent=chosenSources.size+' responses selected for the next report (maximum 16).';
  const sources=state.sources.slice().reverse(),visible=sources.slice(sourceOffset,sourceOffset+50);
  $('#source-list').innerHTML=sources.length?'<div class="table-wrap"><table><thead><tr><th>Use</th><th>Original response</th><th class="numeric">Rows / bytes</th><th>Received (UTC)</th><th>Selection</th><th>Original file</th></tr></thead><tbody>'+visible.map(source=>'<tr><td><input type="checkbox" data-source="'+source.id+'" aria-label="Use '+escape(source.name)+'"'+(chosenSources.has(source.id)?' checked':'')+'></td><td>'+escape(source.name)+'<small>'+escape(short(source.bodySha256))+' · HTTP '+source.status+'</small></td><td class="numeric">'+count(source.returnedFeatures)+' rows<br>'+count(source.bytes)+' B</td><td>'+escape(stamp(source.receivedAt))+'</td><td>'+escape(source.plan?source.plan.mode==='feed'?source.plan.magnitude+' / '+source.plan.period:source.window?.starttime+' to '+source.window?.endtime:'Retained original file')+
    (source.counts?'<small>Count before '+source.counts.before+' / after '+source.counts.after+'</small>':'')+((state.coverage?.[source.id]??[]).length?'<details><summary>Site selection notes</summary>'+state.coverage[source.id].map(note=>'<p>'+escape(note)+'</p>').join('')+'</details>':'')+
    '<details><summary>Source identity</summary><dl><dt>SHA-256</dt><dd class="mono">'+escape(source.bodySha256)+'</dd><dt>Original URL</dt><dd>'+external(source.url)+'</dd><dt>Note</dt><dd>'+escape(source.note??'')+'</dd></dl><pre>'+escape(JSON.stringify(source.metadata,null,2))+'</pre></details></td><td>'+fileLink('sources/'+source.id+'/raw','Download')+'</td></tr>').join('')+'</tbody></table></div>'+pagination('sources',sourceOffset,50,sources.length):empty('Receive an original source response or capture a public source to prepare the first report.');
  controls();
}
function pagination(kind,offset,limit,total){
  return '<div class="pagination"><span>'+(total?offset+1:0)+'–'+Math.min(offset+limit,total)+' of '+total+'</span><button data-action="previous-'+kind+'"'+(offset===0?' data-unavailable="true"':'')+'>Previous</button><button data-action="next-'+kind+'"'+(offset+limit>=total?' data-unavailable="true"':'')+'>Next</button></div>';
}

function editionsPage(){
  const current=selectedEdition(),previous=state.editions.length>1?state.editions[state.editions.length-2]:null;
  if(!comparisonSelection.before)comparisonSelection.before=previous?.id??current?.id??'';
  if(!comparisonSelection.after)comparisonSelection.after=current?.id??'';
  return pageHead('Report editions','Prepare an immutable facility report from a saved roster and explicitly selected original response files.')+
    '<section class="panel"><h2>Prepare a report edition</h2><form id="edition-form"><div class="grid">'+
    field('label','Report name',state.project.title+' — '+new Date().toISOString().slice(0,10),'text','maxlength="200" required')+
    field('operator','Preparing operator',state.project.operator,'text','maxlength="200" required')+
    '<label>Saved facility roster<select name="rosterId" required>'+state.rosters.slice().reverse().map(item=>option(item.id,item.label+' · '+stamp(item.createdAt),item.id===state.project.currentRosterId)).join('')+'</select></label>'+
    '<label>Original response editions<select name="sourceIds" multiple size="7" required>'+state.sources.slice().reverse().map(item=>option(item.id,item.name+' · '+item.returnedFeatures+' rows · '+stamp(item.receivedAt),chosenSources.has(item.id))).join('')+'</select><small class="hint">Select 1–16 responses. Earlier or overlapping windows remain separate choices; the original engine resolves repeated event IDs and updates.</small></label></div>'+
    area('note','Report context and source-selection rationale','',8000,3)+
    '<div class="actions"><button type="submit" class="primary"'+(!state.rosters.length||!state.sources.length?' data-unavailable="true"':'')+'>Prepare and select report edition</button><button type="button" data-page="sources">Open source selections</button></div></form></section>'+
    '<section class="panel"><h2>Saved report editions</h2>'+(state.editions.length?'<div class="table-wrap"><table><thead><tr><th>Edition</th><th>Prepared by / UTC</th><th>Roster / sources</th><th class="numeric">Matched sites / pairs</th><th>Use</th><th>Report</th></tr></thead><tbody>'+
    state.editions.slice().reverse().map(item=>'<tr'+(item.id===current?.id?' class="selected-row"':'')+'><td>'+escape(item.label)+'<small>'+escape(short(item.id))+'</small>'+(item.selectionNotes?.length?'<details><summary>Source selection notes</summary>'+item.selectionNotes.map(note=>'<p>'+escape(note)+'</p>').join('')+'</details>':'')+'</td><td>'+escape(item.operator)+'<small>'+escape(stamp(item.createdAt))+'</small></td><td>'+escape(rosterName(item.rosterId))+'<small>'+item.sourceIds.length+' response files</small></td><td class="numeric">'+item.counts.facilitiesWithMatches+' sites<br>'+item.counts.facilityEventMatches+' pairs</td><td><button data-action="select-edition" data-id="'+item.id+'"'+(item.id===current?.id?' data-unavailable="true"':'')+'>'+(item.id===current?.id?'Selected':'Select')+'</button></td><td>'+fileLink('editions/'+item.id+'/handover.html','Open',{},true)+'<br>'+fileLink('editions/'+item.id+'/report.json','JSON')+' · '+fileLink('editions/'+item.id+'/report.csv','CSV')+'</td></tr>').join('')+'</tbody></table></div>':empty('The first prepared report will appear here.'))+'</section>'+
    '<section class="panel"><h2>Compare retained editions</h2><form id="comparison-form"><div class="inline-fields"><label>Before<select name="before">'+state.editions.map(item=>option(item.id,item.label+' · '+stamp(item.createdAt),item.id===comparisonSelection.before)).join('')+'</select></label><label>After<select name="after">'+state.editions.map(item=>option(item.id,item.label+' · '+stamp(item.createdAt),item.id===comparisonSelection.after)).join('')+'</select></label><button type="submit"'+(!state.editions.length?' data-unavailable="true"':'')+'>Compare editions</button></div></form><div id="comparison-results"></div></section>';
}
function renderComparison(){
  const box=$('#comparison-results');if(!box)return;
  if(!comparison){box.innerHTML=empty('Choose two saved editions to compare exact facility and event values.');return;}
  box.innerHTML='<div class="stats">'+['added','changed','unchanged','outside-current-selection'].map(key=>stat(comparison.counts[key],label(key))).join('')+'</div>'+
    '<p class="hint">An item outside the later selection remains in the operating queue. Its preceding review and assignment stay attached to the original retained edition.</p>'+
    '<div class="actions">'+fileLink('comparison.csv','Download complete comparison CSV',{before:comparison.before,after:comparison.after})+'</div>'+
    '<div class="table-wrap"><table><thead><tr><th>Change</th><th>Facility / event</th><th class="numeric">Magnitude before → after</th><th class="numeric">Distance before → after (km)</th><th>Event update before → after</th></tr></thead><tbody>'+
    comparison.rows.map(item=>{const row=item.after??item.before;return '<tr><td>'+badge(item.change)+'</td><td>'+escape(row.facility.name)+'<small>'+escape(row.event.id)+'</small></td><td class="numeric">'+escape(item.before?.event.magnitude??'—')+' → '+escape(item.after?.event.magnitude??'—')+'</td><td class="numeric">'+escape(item.before?.event.distanceKm??'—')+' → '+escape(item.after?.event.distanceKm??'—')+'</td><td>'+escape(stamp(item.before?.event.updatedUtc))+'<br>→ '+escape(stamp(item.after?.event.updatedUtc))+'</td></tr>';}).join('')+'</tbody></table></div>'+
    pagination('comparison',comparison.offset,comparison.limit,comparison.total);
  controls();
}
function workPage(){
  return pageHead('Operating queue','Assign event reviews, record the site action and preserve the original context of each decision.')+
    '<section class="panel"><form id="work-filter-form"><div class="grid"><label>Work selection<select name="edition">'+option('','All retained operating work',!workFilter.edition)+state.editions.slice().reverse().map(item=>option(item.id,item.label+' · '+stamp(item.createdAt),item.id===workFilter.edition)).join('')+'</select></label>'+
    '<label>Review state<select name="status">'+option('','All states',!workFilter.status)+['needs-review','assigned','investigating','action-recorded','closed'].map(value=>option(value,label(value),value===workFilter.status)).join('')+'</select></label>'+
    field('assignee','Assigned operator',workFilter.assignee,'search')+field('q','Facility or event search',workFilter.q,'search')+'</div><label class="check"><input name="open" type="checkbox"'+(workFilter.open?' checked':'')+'>Keep open work in view</label><div class="actions"><button type="submit">Apply selection</button>'+fileLink('work.csv','Export complete operating queue CSV')+'</div></form></section><section class="panel"><div id="work-results"></div></section>';
}
async function loadWork(){
  const query=new URLSearchParams({edition:workFilter.edition,status:workFilter.status,assignee:workFilter.assignee,q:workFilter.q,open:workFilter.open?'1':'0',offset:String(workFilter.offset),limit:'50'});
  workResult=await api(route('work')+'?'+query);
}
function renderWork(){
  const box=$('#work-results');if(!box)return;
  if(!workResult){box.innerHTML=empty('Loading retained operating work.');return;}
  box.innerHTML='<div class="stats">'+['needs-review','assigned','investigating','action-recorded'].map(key=>stat(workResult.counts[key],label(key))).join('')+'</div>'+
    (workResult.rows.length?'<div class="table-wrap"><table><thead><tr><th>Facility / event</th><th>Event (UTC)</th><th class="numeric">Magnitude / distance</th><th>Operating state</th><th>Assignment / due</th><th>Review</th></tr></thead><tbody>'+
    workResult.rows.map((row,index)=>'<tr><td>'+escape(row.facility.name)+'<small>'+escape(row.event.id)+'</small><small>'+escape(row.reportLabel)+'</small></td><td>'+escape(stamp(row.event.timeUtc))+'<small>'+escape(row.event.place)+'</small></td><td class="numeric">M '+escape(row.event.magnitude)+'<br>'+escape(row.event.distanceKm)+' km</td><td>'+badge(row.status)+(row.sourceChanged?'<small>Event or facility selection changed</small>':'')+(row.carriedFrom?'<small>Review carried from an unchanged earlier edition</small>':'')+'</td><td>'+escape(row.assignee||'Unassigned')+'<small>'+escape(stamp(row.review?.dueUtc))+'</small></td><td><button data-action="review-event" data-index="'+index+'">Open review</button></td></tr>').join('')+'</tbody></table></div>':empty('There are no retained facility/event matches in this work selection.'))+
    pagination('work',workResult.offset,workResult.limit,workResult.total);
  controls();
}
async function openReview(index){
  const row=workResult.rows[index];if(!row)return;
  const result=await api(route('history')+'?'+new URLSearchParams({pair:row.pair}));
  currentReview={row,history:result.reviews};historyLimit=50;
  $('#review-title').textContent=row.facility.name+' — '+row.event.id;
  const prior=row.review,edition=state.editions.find(value=>value.id===row.editionId),sites=state.rosters.find(value=>value.id===edition?.rosterId),siteDetails=sites?.details[row.facility.id]??{};
  $('#review-body').innerHTML='<div class="two-column"><section><dl><dt>Event time</dt><dd>'+escape(stamp(row.event.timeUtc))+'</dd><dt>Source update</dt><dd>'+escape(stamp(row.event.updatedUtc))+'</dd><dt>Magnitude</dt><dd>'+escape(row.event.magnitude)+'</dd><dt>Epicentral distance</dt><dd>'+escape(row.event.distanceKm)+' km</dd><dt>Facility screen</dt><dd>'+escape(row.facility.radiusKm)+' km / M '+escape(row.facility.minimumMagnitude)+'</dd><dt>Source edition</dt><dd>'+escape(row.reportLabel)+'</dd><dt>Original USGS event</dt><dd>'+external(row.event.url,row.event.id)+'</dd></dl>'+
    (row.sourceChanged?'<div class="callout"><p>The latest saved review belongs to earlier event or facility values. Record the decision for this retained edition below; the earlier attribution remains in its history.</p></div>':'')+
    '<details open><summary>Site operating procedure</summary><p>Site contact: '+escape(siteDetails.owner??'')+'</p><pre>'+escape(siteDetails.procedure||state.project.procedure||'Record the applicable site procedure in Facilities or Project settings.')+'</pre><p>'+escape(siteDetails.notes??'')+'</p></details></section>'+
    '<section><form id="review-form"><div class="grid"><label>Review state<select name="status">'+['assigned','investigating','action-recorded','closed'].map(value=>option(value,label(value),value===(row.sourceChanged?'investigating':prior?.status??'investigating'))).join('')+'</select></label>'+
    field('operator','Recording operator',state.project.operator||prior?.operator||'','text','maxlength="200" required')+field('assignee','Assigned operator',prior?.assignee??'','text','maxlength="200"')+
    field('dueUtc','Due time (UTC)',utcValue(prior?.dueUtc),'datetime-local','step="0.001"')+'</div>'+area('action','Recorded action or decision',prior?.action??'',8000,4)+area('notes','Decision rationale',prior?.notes??'',8000,4)+
    '<div class="actions"><button type="submit" class="primary">Save attributed review</button></div></form></section></div><section><h2>Full review history</h2><div id="review-history"></div></section>';
  renderHistory();$('#review-dialog').showModal();controls();
}
function renderHistory(){
  const box=$('#review-history');if(!box||!currentReview)return;
  const history=currentReview.history.slice().reverse();
  box.innerHTML=history.length?history.slice(0,historyLimit).map(item=>'<article class="history-entry"><p>'+badge(item.status)+' <strong>'+escape(item.operator)+'</strong> · '+escape(stamp(item.createdAt))+'</p><p>Assigned: '+escape(item.assignee||'—')+' · Due: '+escape(stamp(item.dueUtc))+'</p><pre>'+escape(item.action)+'</pre><pre>'+escape(item.notes)+'</pre><p class="mono">Edition '+escape(item.editionId)+'<br>Review '+escape(item.id)+'</p></article>').join('')+
    (historyLimit<history.length?'<button data-action="older-history">Show earlier reviews ('+(history.length-historyLimit)+')</button>':''):empty('The first attributed review will appear here.');
}
function deliveryPage(){
  const current=selectedEdition(),project=state.project,sites=current?state.rosters.find(item=>item.id===current.rosterId):null;
  return pageHead('Customer delivery','Hand over the selected operating report and the complete retained workspace, then continue the received work in a separate customer copy.')+
    '<div class="two-column"><section class="panel"><h2>Selected customer report</h2>'+(current?'<p><strong>'+escape(current.label)+'</strong><br>'+escape(stamp(current.createdAt))+' · '+escape(current.operator)+'</p>'+
    '<div class="actions">'+fileLink('editions/'+current.id+'/handover.html','Open printable customer handover',{},true)+'</div><div class="actions">'+fileLink('editions/'+current.id+'/report.json','Original report JSON')+fileLink('editions/'+current.id+'/report.csv','Full matched-event CSV')+'</div>'+
    '<div class="actions">'+fileLink('work.csv','Selected-edition operating decisions CSV',{edition:current.id})+fileLink('rosters/'+current.rosterId+'/raw','Exact report facility input')+'</div>'+
    '<details><summary>Edition and report identities</summary><dl><dt>Edition</dt><dd class="mono">'+escape(current.id)+'</dd><dt>Report SHA-256</dt><dd class="mono">'+escape(current.reportSha256)+'</dd><dt>Roster</dt><dd>'+escape(sites?.label)+'</dd><dt>Prepared by</dt><dd>'+escape(current.operator)+'</dd></dl></details>':empty('Prepare and select a report edition to create a customer handover.'))+'</section>'+
    '<section class="panel"><h2>Complete operating workspace</h2><p>The portable file includes all original response bytes, saved facility rosters, source queries, report editions, capture observations, attributed reviews and assignment history.</p>'+
    '<div class="actions">'+fileLink('export','Export complete workspace')+fileLink('work.csv','Full operating queue CSV')+'</div><p>Receive the file into this or another local workspace to continue from the retained sources. Every report is recomputed during receiving.</p><div class="actions"><button data-action="receive">Receive and reopen a handover</button></div></section></div>'+
    '<section class="panel"><h2>Original sources for the selected report</h2>'+(current?'<div class="table-wrap"><table><thead><tr><th>Original response</th><th>Received (UTC)</th><th>SHA-256</th><th>Download</th></tr></thead><tbody>'+
    current.sourceIds.map(id=>{const source=state.sources.find(item=>item.id===id);return '<tr><td>'+escape(source.name)+'<small>'+count(source.returnedFeatures)+' rows · '+count(source.bytes)+' bytes</small></td><td>'+escape(stamp(source.receivedAt))+'</td><td class="mono">'+escape(source.bodySha256)+'</td><td>'+fileLink('sources/'+source.id+'/raw','Original file')+'</td></tr>';}).join('')+'</tbody></table></div>':empty('The selected report’s original response files will be listed here.'))+'</section>'+
    '<section class="panel"><h2>Installed customer workflow</h2><p>Open the same private workspace through the installed <strong>Facility operations</strong> application or its <code>usgs-facility-events</code> command. The retained-file, report and receiving paths operate from the saved data.</p><details><summary>Command examples</summary><pre>starforge usgs-facility-events --workspace /private/facility-desk\n\nstarforge usgs-facility-events export --workspace /private/facility-desk --project '+escape(project.id)+' --out /delivery/customer-workspace.ndjson\n\nstarforge usgs-facility-events import --workspace /private/received-desk --input /delivery/customer-workspace.ndjson</pre></details>'+
    (info.source?'<details><summary>Running source identity</summary><p class="mono">'+escape(info.source.sha256)+'</p><p>'+info.source.files.length+' original runtime files in this launch.</p></details>':'')+'</section>';
}
function readQuery(){
  const form=$('#query-form'),v=values(form);
  const result={label:v.label,mode:v.mode};
  if(v.mode==='feed')return {...result,magnitude:v.magnitude,period:v.period};
  if(!v.starttime||!v.endtime)throw new Error('Choose the start and end of the fixed UTC window.');
  if(String(v.minmagnitude).trim()==='')throw new Error('Enter the minimum magnitude for this catalog selection.');
  if(v.bounded&&['minlatitude','maxlatitude','minlongitude','maxlongitude'].some(key=>String(v[key]).trim()===''))throw new Error('Enter all four geographic bounds.');
  return {...result,starttime:utc(v.starttime),endtime:utc(v.endtime),minmagnitude:Number(v.minmagnitude),bounds:v.bounded?{
    minlatitude:Number(v.minlatitude),maxlatitude:Number(v.maxlatitude),minlongitude:Number(v.minlongitude),maxlongitude:Number(v.maxlongitude)}:null};
}
function applyQuery(plan){
  const form=$('#query-form');
  fill(form,{...defaultQuery(),...plan,starttime:utcValue(plan.starttime),endtime:utcValue(plan.endtime),bounded:Boolean(plan.bounds),...(plan.bounds??{})});
  queryVisibility();remember(form);clearOperation(form);controls();
}
function parseCsv(text){
  const rows=[];let row=[],cell='',quoted=false,closed=false;
  text=text.replace(/^\uFEFF/,'');
  for(let i=0;i<text.length;i++){
    const c=text[i];
    if(quoted){
      if(c==='"'&&text[i+1]==='"'){cell+='"';i++;}
      else if(c==='"'){quoted=false;closed=true;}else cell+=c;
    }else if(c==='"'){if(cell||closed)throw new Error('A CSV quote occurs inside an unquoted field.');quoted=true;}
    else if(c===','||c==='\n'||c==='\r'){
      row.push(cell);cell='';closed=false;
      if(c!==','){if(c==='\r'&&text[i+1]==='\n')i++;if(row.some(value=>value!==''))rows.push(row);row=[];}
    }else{if(closed)throw new Error('Unexpected characters after a quoted CSV field.');cell+=c;}
  }
  if(quoted)throw new Error('The roster CSV has an unfinished quoted field.');
  if(cell!==''||row.length){row.push(cell);rows.push(row);}
  return rows;
}
function rosterFromCsv(text,name){
  const rows=parseCsv(text),headers=rows.shift()??[],required=['id','name','latitude','longitude','radiusKm','minimumMagnitude'];
  if(new Set(headers).size!==headers.length||required.some(key=>!headers.includes(key)))throw new Error('Use unique CSV headings including '+required.join(', ')+'.');
  const facilities=[],details={};
  for(const row of rows){
    if(row.length!==headers.length)throw new Error('Every facility CSV row must have the same columns as its heading.');
    const v=Object.fromEntries(headers.map((key,index)=>[key,row[index]]));
    facilities.push(Object.fromEntries(required.map(key=>[key,v[key]])));
    details[v.id]={owner:v.owner??'',procedure:v.procedure??'',notes:v.notes??''};
  }
  return {label:name.replace(/\.csv$/i,''),facilityInput:{schema:'commons.facility-watch-input.v1',facilities},details};
}
function rosterCsv(value){
  const headers=['id','name','latitude','longitude','radiusKm','minimumMagnitude','owner','procedure','notes'];
  const cell=value=>{let text=String(value??'');if(typeof value==='string'&&/^[\s]*[=+@\t\r-]/.test(text))text="'"+text;return '"'+text.replaceAll('"','""')+'"';};
  return [headers,...value.facilityInput.facilities.map(site=>headers.map(key=>site[key]??value.details[site.id]?.[key]??''))].map(row=>row.map(cell).join(',')).join('\r\n')+'\r\n';
}

function adoptSources(ids){
  if(JSON.stringify([...chosenSources])!==JSON.stringify(ids))pendingOperations.delete(String(projectId)+':edition-form');
  chosenSources=new Set(ids);
  const key=String(projectId)+':edition-form',draft=drafts.get(key);
  if(draft){draft.sourceIds=[...chosenSources];drafts.set(key,draft);}
}
async function chooseProject(id){
  if(projectId&&rosterDraft)rosterDrafts.set(projectId,clone(rosterDraft));
  projectId=id;state=null;rosterDraft=rosterDrafts.get(id)??null;siteIndex=0;workResult=null;comparison=null;comparisonOffset=0;
  workFilter={edition:'',status:'',assignee:'',q:'',open:true,offset:0};comparisonSelection={before:'',after:''};sourceOffset=0;
  if(id){await refresh();adoptSources(selectedEdition()?.sourceIds??[]);}
  try{sessionStorage.setItem('facility-project:'+info.workspaceId,id??'');}catch{}
}
async function navigate(next){
  if(!state&&next!=='overview')return;
  if(page==='facilities')takeFacility();
  page=next;
  if(page==='work'){workResult=null;render();await loadWork();renderWork();}
  else render();
  $('#main').focus({preventScroll:true});notice('');
}
async function compare(){
  const valuesNow=values($('#comparison-form'));comparisonSelection={before:valuesNow.before,after:valuesNow.after};
  comparison=await api(route('comparison')+'?'+new URLSearchParams({...comparisonSelection,offset:String(comparisonOffset),limit:'50'}));
  renderComparison();
}
function schedulePoll(){
  clearTimeout(pollTimer);pollTimer=null;
  if(!state?.captures.some(item=>item.state==='capturing'))return;
  pollTimer=setTimeout(async()=>{
    if(busy){schedulePoll();return;}
    try{const id=projectId;await refresh();if(id===projectId&&page==='sources')sourcePieces();if(id===projectId)$('#workspace-note').textContent='Revision '+state.project.revision+'\n'+state.project.title;}
    catch(error){notice(error.message,true);}
    schedulePoll();
  },document.visibilityState==='hidden'?5000:1500);
}
async function historicalExample(button){
  const operatorName=state.project.operator;
  if(!operatorName)throw new Error('Record the preparing operator name in Project settings before opening the historical example.');
  const op=operation(button),example=await api('/api/example');
  const created=await api('/api/projects',{method:'POST',data:{title:'South Napa — historical operating walkthrough',organisation:'Illustrative facility case',operator:operatorName,
    procedure:'Apply the recorded site procedure. Use this historical case to practise assigned event review and a complete receiving handover.',
    handoverContact:'',operationId:op+':project'}});
  await refreshInfo();await chooseProject(created.projectId);
  const sites=await api(route('rosters'),{method:'POST',data:{label:'Original three-site Napa example',facilityInput:example.facilities,details:{},revision:state.project.revision,operationId:op+':roster'}});
  const query=new URLSearchParams({name:'historical-response.json',url:example.source.url,note:'Original retained USGS response from the existing Postman facility example.'});
  const source=await api(route('sources')+'?'+query,{method:'POST',body:new Blob([example.sourceText],{type:'application/geo+json'}),headers:{'X-Project-Revision':String(state.project.revision),'X-Operation-Id':op+':source'}});
  const result=await api(route('editions'),{method:'POST',data:{rosterId:sites.id,sourceIds:[source.id],label:'2014 South Napa — original three-site report',operator:operatorName,
    note:example.facilities.description,revision:state.project.revision,operationId:op+':edition'}});
  await refresh();adoptSources([source.id]);rosterDraft=null;page='work';workResult=null;render();await loadWork();renderWork();
  clearOperation(button);notice('The original historical case is ready: '+result.counts.facilityEventMatches+' facility/event matches in its separate project.');
}
document.addEventListener('submit',event=>{
  const form=event.target;if(!(form instanceof HTMLFormElement))return;
  event.preventDefault();if(busy)return;
  act('Saving the retained workspace…',async()=>{
    const id=form.id,input=values(form),op=operation(form);
    if(id==='new-project-form'){
      const result=await api('/api/projects',{method:'POST',data:{...input,operationId:op}});
      clearDraft(form);form.reset();$('#project-dialog').close();await refreshInfo();await chooseProject(result.projectId);page='overview';render();notice('Customer project created.');return;
    }
    if(id==='receive-form'){
      const file=form.elements.file.files[0];if(!file)throw new Error('Select the complete workspace file.');
      const result=await api('/api/import',{method:'POST',body:file,headers:{'Content-Type':'application/x-ndjson','X-Operation-Id':op}});
      clearDraft(form);form.reset();$('#receive-dialog').close();await refreshInfo();await chooseProject(result.projectId);page='overview';render();
      notice('Received and recomputed '+result.entries+' retained items. The original source bytes and attributed history are available in this customer copy.');return;
    }
    if(id==='settings-form'){
      await api(route(''),{method:'PATCH',data:{...input,revision:state.project.revision,operationId:op}});clearDraft(form);await refreshInfo();await refresh();render();notice('Project settings saved.');return;
    }
    if(id==='facility-editor-form'){
      takeFacility();clearDraft(form);render();notice('Facility details applied to the roster draft. Save its edition to use it in a report.');return;
    }
    if(id==='roster-import-form'){
      const file=form.elements.file.files[0];if(!file)throw new Error('Select the roster file.');if(file.size>8*1024*1024)throw new Error('The roster file exceeds 8 MiB.');
      const text=await file.text(),value=/\.csv$/i.test(file.name)?rosterFromCsv(text,file.name):JSON.parse(text.replace(/^\uFEFF/,''));
      const native=value.facilityInput??value;
      if(native.schema!=='commons.facility-watch-input.v1'||!Array.isArray(native.facilities)||native.facilities.length>500)throw new Error('Choose an original facility-watch roster with at most 500 sites.');
      rosterDraft={label:value.label??file.name.replace(/\.(json|csv)$/i,''),facilityInput:native,details:value.details??{}};siteIndex=0;
      clearDraft(form);fileDrafts.delete(draftKey(form)+':file');render();notice('The roster is open as an editable draft.');return;
    }
    if(id==='source-import-form'){
      const files=[...form.elements.files.files];if(!files.length||files.length>16)throw new Error('Select 1–16 original response files for this intake.');
      if(files.some(file=>file.size>64*1024*1024))throw new Error('An original source response exceeds 64 MiB.');
      const sourceIds=[];
      for(let index=0;index<files.length;index++){
        const file=files[index],query=new URLSearchParams({name:file.name,status:input.status,note:input.note});
        const result=await api(route('sources')+'?'+query,{method:'POST',body:file,headers:{'X-Project-Revision':String(state.project.revision),'X-Operation-Id':op+':'+index}});
        sourceIds.push(result.id);
      }
      adoptSources(sourceIds);clearDraft(form);fileDrafts.delete(draftKey(form)+':files');form.reset();await refresh();sourceOffset=0;sourcePieces();notice(files.length+' original response files retained and selected for the next report.');return;
    }
    if(id==='query-form'){
      const plan=readQuery(),result=await api(route('captures'),{method:'POST',data:{...plan,revision:state.project.revision,operationId:op}});
      clearOperation(form);remember(form);await refresh();sourcePieces();notice('Source capture '+short(result.id)+' is '+result.state+'. Its original HTTP observations are retained as they arrive.');return;
    }
    if(id==='edition-form'){
      const sourceIds=input.sourceIds??[];if(!sourceIds.length||sourceIds.length>16)throw new Error('Select 1–16 original response editions.');
      const result=await api(route('editions'),{method:'POST',data:{...input,sourceIds,revision:state.project.revision,operationId:op}});
      chosenSources=new Set(sourceIds);clearDraft(form);await refresh();render();notice('Report edition saved: '+result.counts.facilityEventMatches+' matches from '+result.counts.receivedFeatures+' received event rows.');return;
    }
    if(id==='comparison-form'){comparisonOffset=0;await compare();notice('Retained editions compared.');return;}
    if(id==='work-filter-form'){
      workFilter={...input,open:input.status==='closed'?false:input.open,offset:0};if(input.status==='closed')form.elements.open.checked=false;remember(form);
      await loadWork();renderWork();notice(workResult.total+' retained work items in this selection.');return;
    }
    if(id==='review-form'){
      const row=currentReview.row;
      await api(route('reviews'),{method:'POST',data:{...input,dueUtc:utc(input.dueUtc),pair:row.pair,editionId:row.editionId,revision:state.project.revision,operationId:op}});
      clearDraft(form);$('#review-dialog').close();currentReview=null;await refresh();await loadWork();renderWork();notice('Attributed review saved with its original facility/event edition.');return;
    }
  });
});
document.addEventListener('click',event=>{
  const target=event.target.closest('button');if(!target||busy)return;
  const action=target.dataset.action,next=target.dataset.page;
  if(next){act('Opening '+label(next)+'…',()=>navigate(next));return;}
  if(!action)return;
  if(action==='new-project'){$('#project-dialog').showModal();$('#new-project-form').elements.title.focus();return;}
  if(action==='receive'){$('#receive-dialog').showModal();return;}
  if(action==='close-dialog'){target.closest('dialog').close();return;}
  act('Updating the retained workspace…',async()=>{
    if(action==='save-roster'){
      const value=takeRoster(),op=operation(target);
      await api(route('rosters'),{method:'POST',data:{...value,revision:state.project.revision,operationId:op}});
      await refresh();rosterDraft=initialRoster();rosterDrafts.set(projectId,clone(rosterDraft));clearOperation(target);render();notice('New facility roster edition saved.');return;
    }
    if(action==='add-facility'){
      takeFacility();if(rosterDraft.facilityInput.facilities.length>=500)throw new Error('The original report supports at most 500 facilities.');
      rosterDraft.facilityInput.facilities.push({id:'',name:'',latitude:null,longitude:null,radiusKm:100,minimumMagnitude:4});
      siteIndex=rosterDraft.facilityInput.facilities.length-1;render();$('#facility-editor-form').elements.id.focus();notice('Enter the new facility’s stable ID, coordinates and operating details.');return;
    }
    if(action==='edit-facility'){takeFacility();siteIndex=Number(target.dataset.index);render();notice('');return;}
    if(action==='remove-facility'){
      const item=rosterDraft.facilityInput.facilities[siteIndex];rosterDraft.facilityInput.facilities.splice(siteIndex,1);if(item)delete rosterDraft.details[item.id];
      siteIndex=Math.max(0,siteIndex-1);render();notice('Facility removed from the next roster draft. Its saved editions remain in the operating history.');return;
    }
    if(action==='open-roster'){
      const item=state.rosters.find(value=>value.id===target.dataset.id);rosterDraft=clone({label:item.label,facilityInput:item.facilityInput,details:item.details});siteIndex=0;render();notice('Saved roster opened as a new editable draft.');return;
    }
    if(action==='roster-json'){smallDownload('facility-roster.json',JSON.stringify(takeRoster(),null,2)+'\n');notice('Complete roster draft downloaded.');return;}
    if(action==='roster-csv'){smallDownload('facility-roster.csv',rosterCsv(takeRoster()),'text/csv; charset=utf-8');notice('Facility roster spreadsheet downloaded.');return;}
    if(action==='save-query'){
      const form=$('#query-form');if(!form.reportValidity()){notice('Complete the source selection fields.');return;}
      await api(route('queries'),{method:'POST',data:{...readQuery(),revision:state.project.revision,operationId:operation(form)+':selection'}});
      clearOperation(form);remember(form);await refresh();render();notice('Exact source selection saved.');return;
    }
    if(action==='open-query'){const item=state.queries.find(value=>value.id===target.dataset.id);applyQuery(item.plan);notice('Saved source selection loaded.');return;}
    if(action==='napa-query'){applyQuery({label:'2014 South Napa — fixed USGS catalog window',mode:'catalog',starttime:'2014-08-24T00:00:00.000Z',endtime:'2014-08-25T00:00:00.000Z',minmagnitude:4,bounds:{minlatitude:37,maxlatitude:39,minlongitude:-123,maxlongitude:-121}});notice('Original Napa catalog selection loaded. Capture it to retain a current response edition.');return;}
    if(action==='historical-example'){await historicalExample(target);return;}
    if(action==='refresh-sources'){await refresh();sourcePieces();notice('Capture and source state refreshed.');return;}
    if(action==='pause-capture'||action==='resume-capture'){
      await api(route('captures/'+target.dataset.id),{method:'POST',data:{action:action==='pause-capture'?'pause':'resume'}});
      await refresh();sourcePieces();notice('Original capture '+(action==='pause-capture'?'paused.':'resumed.'));return;
    }
    if(action==='capture-sources'){
      const job=state.captures.find(value=>value.id===target.dataset.id);adoptSources(job.sourceIds);await navigate('editions');
      notice(job.sourceIds.length+' retained responses selected. One report accepts 1–16 responses and up to 100,000 received rows.');return;
    }
    if(action==='select-edition'){
      const op=operation(target);
      await api(route('selection'),{method:'POST',data:{id:target.dataset.id,revision:state.project.revision,operationId:op}});
      clearOperation(target);await refresh();render();notice('Operating edition selected.');return;
    }
    if(action==='review-event'){await openReview(Number(target.dataset.index));notice('');return;}
    if(action==='older-history'){historyLimit+=50;renderHistory();notice('');return;}
    if(action==='previous-sources'||action==='next-sources'){sourceOffset=Math.max(0,sourceOffset+(action.startsWith('next')?50:-50));sourcePieces();notice('');return;}
    if(action==='previous-work'||action==='next-work'){workFilter.offset=Math.max(0,workFilter.offset+(action.startsWith('next')?50:-50));await loadWork();renderWork();notice('');return;}
    if(action==='previous-comparison'||action==='next-comparison'){comparisonOffset=Math.max(0,comparisonOffset+(action.startsWith('next')?50:-50));await compare();notice('');return;}
  });
});
document.addEventListener('input',event=>{
  if(busy)return;
  const input=event.target,form=input.closest('form');
  if(form){remember(form);clearOperation(form);}
  if(input.id==='roster-label'&&rosterDraft)rosterDraft.label=input.value;
  if(input.id==='roster-description'&&rosterDraft)rosterDraft.facilityInput.description=input.value;
  if(page==='facilities')for(const button of all('[data-action="save-roster"]'))clearOperation(button);
});
document.addEventListener('change',event=>{
  if(busy)return;
  const input=event.target,form=input.closest('form');
  if(input.id==='project-select'){act('Opening customer project…',async()=>{if(page==='facilities')takeFacility();await chooseProject(input.value);page='overview';render();notice('Customer project reopened.');});return;}
  if(form){remember(form);clearOperation(form);if(input.type==='file')fileDrafts.set(draftKey(form)+':'+input.name,[...input.files]);}
  if(form?.id==='query-form'){queryVisibility();controls();}
  if(form?.id==='edition-form'&&input.name==='sourceIds')chosenSources=new Set([...input.selectedOptions].map(value=>value.value));
  if(input.dataset.source){const selected=new Set(chosenSources);if(input.checked)selected.add(input.dataset.source);else selected.delete(input.dataset.source);adoptSources([...selected]);$('#selected-source-count').textContent=chosenSources.size+' responses selected for the next report (maximum 16).';}
});
for(const dialog of all('dialog'))dialog.addEventListener('cancel',event=>{if(busy)event.preventDefault();});
async function boot(){
  busy=true;controls();
  try{
    if(!/^[A-Za-z0-9_-]{43}$/.test(token))throw new Error('Open the complete local workspace URL printed by the launcher.');
    await refreshInfo();let remembered;try{remembered=sessionStorage.getItem('facility-project:'+info.workspaceId);}catch{}
    const chosen=info.projects.find(item=>item.id===remembered)??info.projects[0];
    if(chosen)await chooseProject(chosen.id);render();notice('');
  }catch(error){notice(error.message,true);}
  finally{busy=false;controls();schedulePoll();}
}
await boot();
