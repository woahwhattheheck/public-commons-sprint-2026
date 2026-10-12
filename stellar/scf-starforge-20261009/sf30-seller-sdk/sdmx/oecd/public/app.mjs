// MIT. Industrial operator UI over the original saved OECD project.
const $ = id => document.getElementById(id);
const el = (tag, text, attrs = {}) => { const node = document.createElement(tag); if (text != null) node.textContent = text; for (const [k,v] of Object.entries(attrs)) node.setAttribute(k,v); return node; };
let token = location.hash.slice(1) || sessionStorage.getItem('oecd-capability') || '';
let state, current, draftOperation = crypto.randomUUID(), busy = 0;
const message = text => { $('notice').textContent = text; };
async function api(path, body, raw = false) {
  const response = await fetch(path, { method: body === undefined ? 'GET' : 'POST',
    headers: { Authorization: 'Bearer ' + token, ...(body !== undefined ? { 'Content-Type': body instanceof File ? 'application/zip' : 'application/json' } : {}) },
    ...(body === undefined ? {} : { body: body instanceof File ? body : JSON.stringify(body) }) });
  if (!response.ok) { let error; try { error = await response.json(); } catch {} throw new Error(error?.error || 'Operator returned HTTP ' + response.status); }
  return raw ? response.blob() : response.json();
}
async function work(callback) {
  busy++; document.querySelectorAll('button').forEach(b => { b.disabled = true; }); message('Working on the original saved project…');
  try { const result = await callback(); message('Saved project is current.'); return result; }
  catch(error) { message(error.message); }
  finally { if (!--busy) document.querySelectorAll('button').forEach(b => { b.disabled = false; }); }
}
function option(value, label, selected = false) { const node = el('option', label, {value}); node.selected = selected; return node; }
function showCapture() {
  const capture = state?.captures.find(c => c.id === $('capture').value);
  $('countries').replaceChildren(); $('source-list').replaceChildren();
  if (!capture) { $('capture-summary').textContent = 'Import the complete bundled source or an original source packet.'; return; }
  $('capture-summary').textContent = capture.series.length + ' country series · ' +
    capture.series.reduce((n,s) => n+s.observations,0) + ' original observations · ' + capture.flow.agency_id + '/' + capture.flow.id + '/' + capture.flow.version;
  for (const series of capture.series) {
    const label=el('label'); const input=el('input',null,{type:'checkbox',value:series.country}); input.checked=true;
    label.append(input, document.createTextNode(series.country + ' · ' + series.observations + ' observations')); $('countries').append(label);
  }
  for (const source of capture.sources) {
    const row=el('div',null,{class:'source-member'}); const a=el('a',source.name,{href:source.origin,target:'_blank',rel:'noreferrer'});
    row.append(a,el('div',source.bytes+' bytes · '+source.kind,{class:'muted'}),el('code',source.sha256)); $('source-list').append(row);
  }
}
async function reload() {
  const selectedCapture=$('capture').value, selectedBefore=$('before').value, selectedAfter=$('after').value;
  const selectedProject=$('revision').value, countryInputs=[...$('countries').querySelectorAll('input')], selectedCountries=new Set(countryInputs.filter(x=>x.checked).map(x=>x.value));
  state=await api('/api/oecd/state');
  sessionStorage.setItem('oecd-capability',token); $('connect').hidden=true; $('application').hidden=false;
  $('connection-state').textContent=state.project.directory;
  $('capture').replaceChildren(...state.captures.map(c=>option(c.id,c.label,c.id===selectedCapture))); showCapture();
  if(countryInputs.length && $('capture').value===selectedCapture) $('countries').querySelectorAll('input').forEach(x=>{x.checked=selectedCountries.has(x.value);});
  const seen=new Set(), projects=state.catalog.source_state?.projects || [];
  $('revision').replaceChildren(option('','New analyst source project'));
  for(const project of projects){ const p=project.project||project; if(seen.has(p.id))continue; seen.add(p.id); $('revision').append(option(p.id, p.title+' · revision '+p.revision)); }
  if(seen.has(selectedProject)) $('revision').value=selectedProject;
  $('briefing-list').replaceChildren();
  for(const saved of state.briefings){const button=el('button',saved.title,{'data-id':saved.id});button.append(el('small',saved.series_count+' countries · '+saved.observation_count+' report rows · '+(saved.common_period||'no common numeric period')));if(current?.id===saved.id)button.classList.add('selected');button.onclick=()=>work(()=>openReport(saved.id));$('briefing-list').append(button);}
  if(!state.briefings.length)$('briefing-list').append(el('p','Save an analyst selection to create its report and native customer edition.',{class:'muted'}));
  for(const [id,selected] of [['before',selectedBefore],['after',selectedAfter]])$(id).replaceChildren(...state.briefings.map(b=>option(b.id,b.title+' · '+b.created_at,b.id===selected)));
  if(!selectedBefore && state.briefings.length>1)$('before').value=state.briefings[1].id;
  $('publication-state').textContent='Customer publication revision '+state.catalog.revision;
  $('provider-info').textContent=state.connection?.enabled ? state.connection.provider_url+' · authenticated original provider' : 'Configure the existing provider username and password environment references when launching this project.';
}
function selection() {
  const capture=state.captures.find(c=>c.id===$('capture').value);if(!capture)throw new Error('Import and select an original source capture.');
  const body={operation_id:'oecd-briefing:'+draftOperation,capture_id:capture.id,
    countries:[...$('countries').querySelectorAll('input:checked')].map(x=>x.value),
    start_period:$('start').value,end_period:$('end').value||null,title:$('title').value,notes:$('notes').value};
  if($('revision').value){const candidate=(state.catalog.source_state.projects||[]).map(p=>p.project||p).find(p=>p.id===$('revision').value);
    if(!candidate)throw new Error('Refresh the original project revision.'); body.project_id=candidate.id;body.expected_revision=candidate.revision;}
  return body;
}
async function download(path,name,body) {
  const blob=await api(path,body,true);const url=URL.createObjectURL(blob);const a=el('a',null,{href:url,download:name});a.click();setTimeout(()=>URL.revokeObjectURL(url),30000);
}
const val = value => value == null ? '—' : String(value);
function chart(series) {
  const box=el('div',null,{class:'chart'});box.append(el('h3',series.country_name+' · '+series.country),
    el('p','Latest numeric: '+(series.latest?series.latest.period+' / '+series.latest.value:'none')+
      ' · '+series.missing_periods.length+' missing periods · '+series.missing_value_periods.length+' missing values',{class:'muted'}));
  const ns='http://www.w3.org/2000/svg',svg=document.createElementNS(ns,'svg');svg.setAttribute('viewBox','0 0 720 180');svg.setAttribute('role','img');svg.setAttribute('aria-label',series.country_name+' original monthly CLI');
  const ordinal=p=>Number(p.slice(0,4))*12+Number(p.slice(5,7))-1, rows=series.observations;
  const values=rows.filter(r=>r.numeric_value!==null).map(r=>Number(r.numeric_value));
  if(values.length){let low=Math.min(100,...values),high=Math.max(100,...values),span=Math.max(.25,high-low);low-=span/10;high+=span/10;
    const first=ordinal(rows[0].time_period),last=ordinal(rows.at(-1).time_period),point=r=>[48+(ordinal(r.time_period)-first)*648/Math.max(1,last-first),18+(high-Number(r.numeric_value))/(high-low)*130];
    const baseline=document.createElementNS(ns,'line');for(const[k,v]of Object.entries({x1:48,x2:696,y1:18+(high-100)/(high-low)*130,y2:18+(high-100)/(high-low)*130,stroke:'#999','stroke-dasharray':'4 4'}))baseline.setAttribute(k,v);svg.append(baseline);
    let points=[],prev=null;const flush=()=>{if(points.length){const poly=document.createElementNS(ns,'polyline');poly.setAttribute('points',points.join(' '));poly.setAttribute('fill','none');poly.setAttribute('stroke','#292929');poly.setAttribute('stroke-width','2');svg.append(poly);points=[];}};
    for(const r of rows){const t=ordinal(r.time_period);if(r.numeric_value===null||(prev!==null&&t!==prev+1))flush();if(r.numeric_value!==null)points.push(point(r).join(','));prev=t;}flush();
    for(const[x,text]of[[48,rows[0].time_period],[625,rows.at(-1).time_period]]){const node=document.createElementNS(ns,'text');node.setAttribute('x',x);node.setAttribute('y',176);node.setAttribute('font-size',11);node.textContent=text;svg.append(node);}}
  box.append(svg);return box;
}
async function openReport(id) {
  current=await api('/api/oecd/briefings/'+id);const doc=current.document;
  $('report').hidden=false;$('report-title').textContent=doc.title;$('report-notes').textContent=doc.notes;
  $('report-scope').textContent=doc.scope;$('common-heading').textContent='Same-period comparison · '+val(doc.common_period);
  $('comparison-table').replaceChildren();$('observations').replaceChildren();$('series-charts').replaceChildren();
  for(const series of doc.series){
    const point=series.common;const row=el('tr');for(const value of [series.country_name,point?.value,...[1,3,12].map(n=>point?.changes[String(n)].index_point_change),series.last_period])row.append(el('td',val(value)));$('comparison-table').append(row);
    $('series-charts').append(chart(series));
    for(const r of series.observations){const tr=el('tr');for(const value of [series.country,r.time_period,r.value,r.attributes.OBS_STATUS,r.value_kind,r.dimensions.UNIT_MEASURE+' / '+r.attributes.UNIT_MULT])tr.append(el('td',val(value)));$('observations').append(tr);}
  }
  $('report-downloads').replaceChildren();
  for(const[name,label]of[['briefing.html','HTML report'],['briefing.json','Complete JSON'],['observations.csv','Original-value CSV']]){
    const b=el('button',label);b.onclick=()=>work(()=>download('/api/oecd/briefings/'+id+'/files/'+name,name));$('report-downloads').append(b);}
  for(const[action,label]of[['export-customer','Customer source packet'],['export-project','Complete project packet']]){
    const b=el('button',label);b.onclick=()=>work(()=>download('/api/oecd/'+action,id+'-'+action+'.zip',{briefing_id:id}));$('report-downloads').append(b);}
  const exportDataset=el('button','Prepare native merchant dataset');exportDataset.onclick=()=>work(async()=>{const result=await api('/api/oecd/export-dataset',{briefing_id:id});$('report-identity').textContent=JSON.stringify(result,null,2);});$('report-downloads').append(exportDataset);
  $('report-identity').textContent=JSON.stringify({source_capture:doc.source_capture_id,source_project:doc.source_project_id,source_revision:doc.source_project_revision,native_snapshot:doc.native_snapshot,catalog_edition:doc.catalog_edition_id,report_files:current.report.files},null,2);
  document.querySelectorAll('#briefing-list button').forEach(b=>b.classList.toggle('selected',b.dataset.id===id));
}
$('connect-button').onclick=()=>work(async()=>{token=$('capability').value.trim();await reload();});
$('reload').onclick=()=>work(reload);
$('seed').onclick=()=>work(async()=>{const capture=await api('/api/oecd/seed',{});await reload();$('capture').value=capture.id;showCapture();});
$('capture').onchange=()=>{showCapture();draftOperation=crypto.randomUUID();};
$('new-draft').onclick=()=>{draftOperation=crypto.randomUUID();message('New analyst operation ready.');};
$('preview').onclick=()=>work(async()=>{const r=await api('/api/oecd/preview',selection());$('preview-result').textContent=r.request.countries.length+' countries · '+r.source_observations+' native captured observations · report window '+r.request.start_period+' through '+(r.request.end_period||'latest retained period');});
$('save').onclick=()=>work(async()=>{const r=await api('/api/oecd/briefings',selection());await reload();$('revision').value=r.project_id;draftOperation=crypto.randomUUID();await openReport(r.id);});
$('publish').onclick=()=>work(async()=>{if(!current)throw new Error('Open a saved briefing.');await api('/api/oecd/activate',{briefing_id:current.id,expected_revision:state.catalog.revision,expected_current:state.catalog.current});await reload();});
$('refresh-source').onclick=()=>work(async()=>{const capture=state.captures.find(c=>c.id===$('capture').value);if(!capture)throw new Error('Select an original capture.');const r=await api('/api/oecd/refresh',{operation_id:'oecd-refresh:'+crypto.randomUUID(),capture_id:capture.id,start_period:$('start').value,end_period:$('end').value||null});await reload();$('capture').value=r.id;showCapture();draftOperation=crypto.randomUUID();});
$('capture-file').onchange=()=>work(async()=>{const file=$('capture-file').files[0];if(!file)return;const r=await api('/api/oecd/captures',JSON.parse(await file.text()));await reload();$('capture').value=r.id;showCapture();});
$('project-file').onchange=()=>work(async()=>{const file=$('project-file').files[0];if(!file)return;const r=await api('/api/oecd/import',file);await reload();await openReport(r.id);});
$('compare').onclick=()=>work(async()=>{const r=await api('/api/oecd/compare',{before:$('before').value,after:$('after').value});const target=$('comparison-result');target.replaceChildren(el('p',r.report_changes.length+' changed original observations in the two report selections.'));const table=el('table'),head=el('tr');for(const title of['Country','Period','Change','Earlier value','Later value'])head.append(el('th',title));table.append(head);for(const item of r.report_changes){const row=el('tr');for(const value of[item.country,item.time_period,item.kind,item.before?.value,item.after?.value])row.append(el('td',val(value)));table.append(row);}target.append(table);const details=el('details');details.append(el('summary','Complete native catalog comparison'),el('pre',JSON.stringify(r.native_catalog_comparison,null,2)));target.append(details);});
$('provider-capabilities').onclick=()=>work(async()=>{$('provider-output').textContent=JSON.stringify(await api('/api/provider/getcapabilities'),null,2);});
$('provider-series').onclick=()=>work(async()=>{$('provider-output').textContent=JSON.stringify(await api('/api/provider/listseries'),null,2);});
$('provider-connection').onclick=()=>work(()=>download('/api/connection.xml','oecd-provider.xml'));
if(token)work(async()=>{try{await reload();if(state.briefings[0])await openReport(state.briefings[0].id);}catch(error){$('connect').hidden=false;throw error;}});
else{$('connect').hidden=false;$('connection-state').textContent='Use the original local console link.';}

for(const id of ['title','start','end','revision','notes','countries']) $(id).addEventListener('change',()=>{draftOperation=crypto.randomUUID();});
