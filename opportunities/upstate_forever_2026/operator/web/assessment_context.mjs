/** Assessment geographic context on the original operator and retained task queue. */
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const list=v=>Array.isArray(v)?v:[];
const key=v=>v?String(v.collection_id)+'/'+String(v.source_id):'';
const clone=v=>JSON.parse(JSON.stringify(v));
const canonical=v=>Array.isArray(v)?'['+v.map(canonical).join(',')+']':v&&typeof v==='object'?'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}':JSON.stringify(v);
const ref=v=>({collection_id:v.collection_id,source_id:v.source_id});
const btn=(action,label,extra='')=>'<button type="button" data-ac-action="'+action+'" '+extra+'>'+esc(label)+'</button>';
const empty=()=>({title:'Assessment geographic context',station_geography_id:'',table:null,watershed_source:null,
  relationship_basis:'published_watershed',fields:{},filters:{causes:[],uses:[],counties:[]},
  assessment:{title:'',status:'',vintage:'',reference:''}});
const opts=(rows,value,label,id='id')=>'<option value="">Choose…</option>'+list(rows).map(r=>'<option value="'+esc(r[id])+'" '+(r[id]===value?'selected':'')+'>'+esc(label(r))+'</option>').join('');

export function attachAssessmentContext(host){
 let node=null,workspace=null,state=null,catalog=null,options=null,edition=null,draft=empty();
 let controller=null,epoch=0,busy=false,error='',message='',requests=[],currentTask=null,selectedEdition=null;
 let selectedPolygon='',query='',page=0,taskFingerprint='';
 const read=(operation,value={})=>host.api('/api/assessment-context/'+operation,{method:'POST',body:{workspace,...value},signal:controller?.signal});
 function persist(){
  if(!workspace)return;
  try{sessionStorage.setItem('assessment-context:'+workspace,JSON.stringify({draft,requests:requests.slice(-30),currentTask,selectedEdition,selectedPolygon,query,page}));}catch{}
 }
 function restore(){
  draft=empty();requests=[];currentTask=null;selectedEdition=null;selectedPolygon='';query='';page=0;
  try{const v=JSON.parse(sessionStorage.getItem('assessment-context:'+workspace)||'{}');draft={...draft,...(v.draft||{})};
   requests=list(v.requests);currentTask=v.currentTask||null;selectedEdition=v.selectedEdition||null;
   selectedPolygon=v.selectedPolygon||'';query=v.query||'';page=Number(v.page)||0;}catch{}
 }
 function fail(e){error=e?.message||String(e);message='';notice();}
 function notice(){const t=node?.querySelector('[data-ac-notice]');if(t){t.textContent=error||message;t.className=error?'ac-notice ac-error':'ac-notice';}}
 function table(){return list(options?.tables).find(r=>key(r.reference)===key(draft.table));}
 function defaultTable(t){
  draft.table=t?ref(t.reference):null;draft.fields={...(t?.default_fields||{})};
  draft.filters={causes:[],uses:[],counties:[]};draft.assessment={...empty().assessment,...(t?.assessment_defaults||{})};
 }
 function filterInput(category,field,label){
  const t=table(),values=list(t?.values?.[draft.fields[field]]);
  if(!draft.fields[field])return '';
  return '<label>'+esc(label)+'<select multiple size="'+Math.min(6,Math.max(2,values.length))+'" data-ac-filter="'+category+'">'+
   values.map(v=>'<option value="'+esc(v)+'" '+(list(draft.filters[category]).includes(v)?'selected':'')+'>'+esc(v||'(blank original value)')+'</option>').join('')+
   '</select><small>Leave unselected to include every original value.</small></label>';
 }
 function renderForm(){
  const target=node?.querySelector('[data-ac-form-area]');if(!target)return;
  const t=table();
  target.innerHTML='<form data-ac-form><div class="ac-fields"><label>Saved original station study<select required data-ac-field="station_geography_id">'+
   opts(catalog?.geographies,draft.station_geography_id,r=>r.title+' · '+(r.summary?.station_count??0)+' stations')+'</select></label>'+
   '<label>Original assessment inventory<select required data-ac-table>'+opts(list(options?.tables).map(r=>({...r,id:key(r.reference)})),key(draft.table),r=>r.title+' · '+r.row_count+' rows')+'</select></label>'+
   '<label>Original watershed source<select required data-ac-watershed>'+opts(list(options?.watershed_sources).map(r=>({...r,id:key(r.reference)})),key(draft.watershed_source),r=>r.title)+'</select></label>'+
   '<label>Association used for context<select data-ac-field="relationship_basis"><option value="published_watershed" '+(draft.relationship_basis==='published_watershed'?'selected':'')+'>Original assessment watershed label</option>'+
   '<option value="station_membership" '+(draft.relationship_basis==='station_membership'?'selected':'')+'>Computed station / polygon membership</option></select></label></div>'+
   '<p class="ac-explanation">Both associations remain in every result row. A watershed provides geographic context for the selected records. The result retains draft status and does not assign an impairment designation to the whole polygon.</p>'+
   '<details><summary>Original field bindings</summary><div class="ac-fields">'+['watershed','cause','use','county'].map(f=>'<label>'+esc(f)+' field<select '+(f!=='county'?'required':'')+' data-ac-binding="'+f+'">'+
      '<option value="">'+(f==='county'?'Omit':'Choose…')+'</option>'+list(t?.fields).map(v=>'<option value="'+esc(v)+'" '+(draft.fields[f]===v?'selected':'')+'>'+esc(v)+'</option>').join('')+'</select></label>').join('')+'</div></details>'+
   '<div class="ac-fields">'+filterInput('causes','cause','Original causes')+filterInput('uses','use','Original impaired uses')+filterInput('counties','county','Original counties')+'</div>'+
   '<div class="ac-fields"><label>Context title<input required data-ac-field="title" value="'+esc(draft.title)+'"></label>'+
   ['title','status','vintage','reference'].map(f=>'<label>Assessment '+esc(f)+'<input required data-ac-assessment="'+f+'" value="'+esc(draft.assessment[f])+'"></label>').join('')+'</div>'+
   '<div class="ac-toolbar"><button type="submit" '+(busy||!t?'disabled':'')+'>Prepare geographic context</button>'+btn('reload','Refresh retained studies')+'</div></form>';
 }
 async function loadOptions(id,preserve=false){
  const gen=epoch,keyNow=workspace;if(!id){options=null;renderForm();return;}
  try{const value=await read('options',{geography_id:id});if(gen!==epoch||keyNow!==workspace)return;
   options=value;draft.station_geography_id=id;
   if(!preserve||!list(value.tables).some(t=>key(t.reference)===key(draft.table)))defaultTable(list(value.tables)[0]);
   if(!preserve||!list(value.watershed_sources).some(t=>key(t.reference)===key(draft.watershed_source)))
    draft.watershed_source=value.watershed_sources[0]?ref(value.watershed_sources[0].reference):null;
   persist();renderForm();}catch(e){if(gen===epoch)fail(e);}
 }
 async function loadCatalog(initial=false){
  const gen=epoch;
  try{const value=await read('catalog');if(gen!==epoch)return;catalog=value;
   node.querySelector('[data-ac-editions]').innerHTML=opts(value.editions,selectedEdition,r=>r.title+' · '+r.summary.assessment_row_count+' rows');
   if(initial){if(!draft.station_geography_id&&value.geographies.length)draft.station_geography_id=value.geographies[value.geographies.length-1].id;
    await loadOptions(draft.station_geography_id,true);if(selectedEdition)await openEdition(selectedEdition);}
   else renderForm();
   renderCriteria();}catch(e){if(gen===epoch)fail(e);}
 }
 async function openEdition(id){
  const gen=epoch;
  try{const value=await read('edition',{id});if(gen!==epoch)return;edition=value;selectedEdition=id;
   if(!list(value.geojson?.features).some(f=>f.id===selectedPolygon))selectedPolygon='';
   node.querySelector('[data-ac-editions]').value=id;persist();renderResult();}catch(e){if(gen===epoch)fail(e);}
 }
 function rows(){
  const term=query.toLowerCase();
  return list(edition?.result?.rows).filter(r=>(!selectedPolygon||list(r.selected_polygon_ids).includes(selectedPolygon))&&
    (!term||[r.station_id,r.cause,r.impaired_use,r.original_watershed_value,JSON.stringify(r.original)].join(' ').toLowerCase().includes(term)));
 }
 function renderMap(){
  const target=node?.querySelector('[data-ac-map]');if(!target)return;
  const features=list(edition?.geojson?.features),pairs=[];
  function visit(v){if(Array.isArray(v)&&v.length>=2&&v.slice(0,2).every(Number.isFinite))pairs.push(v);else if(Array.isArray(v))v.forEach(visit);}
  features.forEach(f=>visit(f.geometry?.coordinates));
  if(!pairs.length){target.innerHTML='<p>No selected polygon context.</p>';return;}
  let minX=Infinity,maxX=-Infinity,minY=Infinity,maxY=-Infinity;
  for(const [x,y] of pairs){minX=Math.min(minX,x);maxX=Math.max(maxX,x);minY=Math.min(minY,y);maxY=Math.max(maxY,y);}
  const aspect=Math.max(.05,Math.cos((minY+maxY)*Math.PI/360)),scale=Math.min(940/Math.max(.001,(maxX-minX)*aspect),510/Math.max(.001,maxY-minY));
  const project=p=>[30+(p[0]-minX)*aspect*scale,30+(maxY-p[1])*scale];
  target.innerHTML='<svg viewBox="0 0 1000 570" role="group" aria-label="Original watershed assessment context">'+features.map(f=>{
   const polygons=f.geometry.type==='Polygon'?[f.geometry.coordinates]:f.geometry.coordinates;
   const d=polygons.map(p=>p.map(r=>r.map((c,i)=>{const [x,y]=project(c);return(i?'L':'M')+x.toFixed(5)+' '+y.toFixed(5);}).join(' ')+' Z').join(' ')).join(' ');
   return '<path tabindex="0" role="button" aria-label="Watershed '+esc(f.properties.watershed_id)+'" data-ac-polygon="'+esc(f.id)+'" d="'+d+'" class="'+(f.id===selectedPolygon?'ac-polygon selected':'ac-polygon')+'"><title>'+
    esc(f.properties.watershed_id)+' · '+f.properties.station_count+' stations · '+f.properties.assessment_row_count+' assessment rows</title></path>';
  }).join('')+'</svg><p>Select a watershed to inspect its original assessment rows. '+btn('clear-polygon','Show all selected watersheds')+'</p>';
 }
 function renderRows(){
  const target=node?.querySelector('[data-ac-rows]');if(!target)return;
  const filtered=rows();page=Math.max(0,Math.min(page,Math.ceil(filtered.length/40)-1));
  const shown=filtered.slice(page*40,page*40+40);
  target.innerHTML='<div class="ac-toolbar"><span>'+filtered.length+' original assessment rows</span>'+btn('export-rows','Download filtered CSV')+'</div>'+
   '<div class="ac-table-wrap"><table><thead><tr><th>Station / original row</th><th>Original cause / use</th><th>Published watershed</th><th>Computed membership</th><th>Source detail</th></tr></thead><tbody>'+
   shown.map(r=>'<tr><td>'+esc(r.station_id)+'<small>row '+r.row_number+' · '+esc(r.location_status)+'</small></td><td>'+esc(r.cause)+' / '+esc(r.impaired_use)+
    '</td><td>'+esc(r.original_watershed_value)+'<small>'+esc(r.geographic_status)+'</small></td><td>'+list(r.computed_memberships).map(m=>esc(m.watershed_id)+' ('+esc(m.relation)+')').join('<br>')+
    '<small>'+(r.association_agreement?'Associations agree':'Associations differ')+'</small></td><td><details><summary>Original fields and references</summary><pre>'+esc(JSON.stringify({original:r.original,source:r.source_ref,computed:r.computed_memberships},null,2))+'</pre></details></td></tr>').join('')+
   '</tbody></table></div><div class="ac-toolbar">'+btn('previous','Previous',page===0?'disabled':'')+'<span>Page '+(page+1)+' of '+Math.max(1,Math.ceil(filtered.length/40))+'</span>'+
   btn('next','Next',(page+1)*40>=filtered.length?'disabled':'')+'</div>';
 }
 function renderCriteria(){
  const target=node?.querySelector('[data-ac-criteria]');if(!target)return;
  if(!edition){target.innerHTML='';return;}
  target.innerHTML='<h3>Use with an existing parcel study</h3><p>The parcel criteria operation receives this exact geographic relation and source reference. Areas with no selected assessment association retain unknown coverage.</p>'+
   '<div class="ac-toolbar"><label>Saved original parcel study<select data-ac-parcel-study>'+opts(catalog?.parcel_studies,'',r=>r.title+' · '+r.state)+'</select></label>'+
   btn('criteria','Prepare parcel criteria',busy||!list(catalog?.parcel_studies).length?'disabled':'')+'</div>'+
   (!list(catalog?.parcel_studies).length?'<p>Create or receive a parcel study in Conservation plans to apply this context.</p>':'')+
   '<details><summary>Exact geographic context binding</summary><pre>'+esc(JSON.stringify(edition.parcel_criteria_binding,null,2))+'</pre></details>';
 }
 function renderResult(){
  const result=node?.querySelector('[data-ac-result]');if(!result)return;
  if(!edition){result.innerHTML='<p>Prepare a context from a retained station study or receive a complete context package.</p>';return;}
  const r=edition.result,s=edition.summary,a=r.assessment;
  result.innerHTML='<h2>'+esc(edition.title)+'</h2><p><strong>'+esc(a.title)+' · '+esc(a.status)+' · '+esc(a.vintage)+'</strong></p>'+
   '<p>'+esc(r.relation)+'</p><div class="ac-summary">'+[['Stations',s.station_count],['Assessment rows',s.assessment_row_count],['Watersheds',s.watershed_count],
    ['Unmatched rows',s.unmatched_row_count],['Multiple associations',s.multiple_association_row_count],['Different associations',s.differing_association_row_count]].map(([k,v])=>'<div><strong>'+v+'</strong><span>'+esc(k)+'</span></div>').join('')+'</div>'+
   '<p>Association basis: '+esc(r.relationship_basis)+'. Original record: '+(/^https?:\/\//i.test(a.reference)?'<a href="'+esc(a.reference)+'" target="_blank" rel="noopener noreferrer">'+esc(a.reference)+'</a>':esc(a.reference))+'</p>'+
   '<div data-ac-map class="ac-map"></div><label class="ac-search">Find original station, cause, watershed or source text<input data-ac-search value="'+esc(query)+'"></label>'+
   '<div data-ac-rows></div><section data-ac-criteria></section><h3>Complete source and editable package</h3><div class="ac-downloads">'+
   list(edition._downloads).filter(f=>f.filename!=='started.json'&&f.filename!=='original-station-geography.zip').map(f=>'<a href="'+esc(f.url)+'" download="'+esc(f.filename)+'">'+esc(f.filename)+'</a>').join('')+'</div>';
  renderMap();renderRows();renderCriteria();
 }
 function exportRows(){
  const headers=['station_id','row_number','cause','impaired_use','original_watershed_value','location_status','watershed_status','geographic_status','association_agreement',
    'published_polygon_ids','computed_polygon_ids','selected_polygon_ids','source_ref','original'];
  const cell=v=>{let t=v==null?'':typeof v==='object'?JSON.stringify(v):String(v);if(/^[=+\-@\t\r]/.test(t))t="'"+t;return '"'+t.replace(/"/g,'""')+'"';};
  const text=[headers.join(','),...rows().map(r=>headers.map(k=>cell(r[k])).join(','))].join('\r\n')+'\r\n';
  const url=URL.createObjectURL(new Blob([text],{type:'text/csv;charset=utf-8'})),a=document.createElement('a');
  a.href=url;a.download='assessment-context-filtered.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
 }
 function ownedTasks(){return list(state?.tasks).filter(t=>String(t.action||'').startsWith('assessment.context.'));}
 function renderTasks(){
  const target=node?.querySelector('[data-ac-tasks]');if(!target)return;
  target.innerHTML=ownedTasks().slice(-15).reverse().map(t=>'<div class="ac-task">'+btn('task',t.action+' · '+t.state,'data-id="'+esc(t.id)+'"')+
   (t.error?'<span>'+esc(t.error.message||t.error)+'</span>':'')+'</div>').join('')||'<p>Operations appear here after submission. They remain in the original queue when this desk closes.</p>';
 }
 async function submit(action,payload){
  if(busy)return;const workspaceNow=workspace,requestKey=canonical({workspace,action,payload});
  let request=requests.find(r=>r.key===requestKey);if(!request){request={key:requestKey,id:'assessment-context-'+crypto.randomUUID()};requests.push(request);}
  busy=true;error='';message='Saving this source selection in the original task queue…';persist();notice();
  try{const t=await host.api('/api/actions',{method:'POST',body:{workspace,action,payload,operation_id:request.id}});
   if(workspaceNow!==workspace)return;currentTask=t.id;persist();await host.refresh({force:true});state=host.getState();
   message='Context operation '+t.state+'.';renderTasks();notice();
   if(t.state==='complete'&&t.result?.id&&action!=='assessment.context.criteria'){await loadCatalog();await openEdition(t.result.id);}
  }catch(e){if(workspaceNow===workspace)fail(e);}finally{busy=false;if(workspaceNow===workspace){renderForm();renderCriteria();}}
 }
 function edit(event){
  const t=event.target;
  if(t.matches('[data-ac-field]'))draft[t.dataset.acField]=t.value;
  if(t.matches('[data-ac-assessment]'))draft.assessment[t.dataset.acAssessment]=t.value;
  if(t.matches('[data-ac-filter]'))draft.filters[t.dataset.acFilter]=[...t.selectedOptions].map(o=>o.value);
  if(t.matches('[data-ac-binding]')){if(t.value)draft.fields[t.dataset.acBinding]=t.value;else delete draft.fields[t.dataset.acBinding];}
  persist();
 }
 async function change(event){
  edit(event);const t=event.target;
  if(t.matches('[data-ac-field="station_geography_id"]'))await loadOptions(t.value);
  else if(t.matches('[data-ac-table]')){defaultTable(list(options?.tables).find(r=>key(r.reference)===t.value));persist();renderForm();}
  else if(t.matches('[data-ac-watershed]')){const row=list(options?.watershed_sources).find(r=>key(r.reference)===t.value);draft.watershed_source=row?ref(row.reference):null;persist();}
  else if(t.matches('[data-ac-binding]')){draft.filters={causes:[],uses:[],counties:[]};persist();renderForm();}
  else if(t.matches('[data-ac-editions]')&&t.value)await openEdition(t.value);
  else if(t.matches('[data-ac-receive]')&&t.files[0]){
   try{const file=t.files[0],workspaceNow=workspace;const upload=await host.api('/api/upload',{method:'POST',raw:file,filename:file.name});
    if(workspaceNow===workspace)await submit('assessment.context.receive',{upload_id:upload.id});}catch(e){fail(e);}
  }
 }
 async function click(event){
  const polygon=event.target.closest('[data-ac-polygon]');
  if(polygon){selectedPolygon=polygon.dataset.acPolygon;page=0;persist();renderMap();renderRows();return;}
  const t=event.target.closest('[data-ac-action]');if(!t)return;
  const a=t.dataset.acAction;
  if(a==='reload'){await loadCatalog();await loadOptions(draft.station_geography_id,true);}
  else if(a==='clear-polygon'){selectedPolygon='';page=0;persist();renderMap();renderRows();}
  else if(a==='previous'||a==='next'){page+=a==='previous'?-1:1;persist();renderRows();}
  else if(a==='export-rows')exportRows();
  else if(a==='task')host.showTask(t.dataset.id);
  else if(a==='criteria'){
   const study=node.querySelector('[data-ac-parcel-study]')?.value;
   if(!study){fail(new Error('Choose an original parcel study.'));return;}
   await submit('assessment.context.criteria',{context_id:edition.id,study_id:study});
  }
 }
 function mount(container,initial=host.getState()){
  detach();node=container;state=initial;workspace=host.getWorkspace()||state?.workspace_key;controller=new AbortController();epoch++;restore();
  node.innerHTML='<section class="ac-desk"><header><h1>Assessment geographic context</h1><p>Original assessment records, watershed association and parcel context in one retained source edition.</p></header>'+
   '<p data-ac-notice class="ac-notice" aria-live="polite"></p><details open><summary>Prepare from a saved station study</summary><div data-ac-form-area></div></details>'+
   '<section class="ac-toolbar"><label>Saved context<select data-ac-editions></select></label><label>Receive complete context ZIP<input type="file" accept=".zip" data-ac-receive></label></section>'+
   '<section data-ac-result></section><section><h2>Retained operations</h2><div data-ac-tasks></div></section></section>';
  const signal=controller.signal;node.addEventListener('input',e=>{if(e.target.matches('[data-ac-search]')){query=e.target.value;page=0;persist();renderRows();}else edit(e);},{signal});
  node.addEventListener('change',change,{signal});node.addEventListener('click',click,{signal});
  node.addEventListener('submit',e=>{if(!e.target.matches('[data-ac-form]'))return;e.preventDefault();submit('assessment.context.build',{selection:clone(draft)});},{signal});
  node.addEventListener('keydown',e=>{if(e.target.matches('[data-ac-polygon]')&&['Enter',' '].includes(e.key)){e.preventDefault();click(e);}},{signal});
  renderForm();renderResult();renderTasks();loadCatalog(true);
 }
 function update(next=host.getState()){
  state=next;if(!node)return;const w=next?.workspace_key||host.getWorkspace();if(w!==workspace){mount(node,next);return;}
  const fingerprint=canonical(ownedTasks().map(t=>[t.id,t.state,t.result?.id,t.error]));
  if(fingerprint!==taskFingerprint){taskFingerprint=fingerprint;renderTasks();
   const t=ownedTasks().find(t=>t.id===currentTask);
   if(t?.state==='complete'&&t.result?.id&&t.action!=='assessment.context.criteria'&&t.result.id!==selectedEdition){loadCatalog();openEdition(t.result.id);}
   if(t?.state==='complete'&&t.action==='assessment.context.criteria'){message='Parcel criteria completed with the selected assessment geographic-context source.';notice();}
   if(['failed','interrupted','cancelled'].includes(t?.state)&&t.error)fail(t.error);
  }
 }
 function detach(){persist();controller?.abort();controller=null;epoch++;node=null;edition=null;options=null;catalog=null;busy=false;}
 return {mount,update,detach};
}
