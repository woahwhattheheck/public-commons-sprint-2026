/** Assessment geographic context on the original operator and retained task queue. */
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const list=v=>Array.isArray(v)?v:[];
const sourceLinks=result=>{
 const references=[...new Set(list(result.assessment_groups).map(group=>group.assessment?.reference).filter(value=>typeof value==='string'&&value.trim()))];
 if(!references.length&&result.assessment?.reference)references.push(result.assessment.reference);
 return references.map(reference=>/^https?:\/\/[^\s|]+$/i.test(reference)?'<a href="'+esc(reference)+'" target="_blank" rel="noopener noreferrer">'+esc(reference)+'</a>':esc(reference)).join(' · ');
};
const key=v=>v?String(v.collection_id)+'/'+String(v.source_id):'';
const clone=v=>JSON.parse(JSON.stringify(v));
const canonical=v=>Array.isArray(v)?'['+v.map(canonical).join(',')+']':v&&typeof v==='object'?'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+canonical(v[k])).join(',')+'}':JSON.stringify(v);
const ref=v=>({collection_id:v.collection_id,source_id:v.source_id});
const btn=(action,label,extra='')=>'<button type="button" data-ac-action="'+action+'" '+extra+'>'+esc(label)+'</button>';
const empty=()=>({title:'Assessment geographic context',station_geography_id:'',table:null,inventories:[],watershed_source:null,
  relationship_basis:'published_watershed',fields:{},filters:{causes:[],uses:[],counties:[],editions:[],supports:[]},
  assessment:{title:'',status:'',vintage:'',reference:''}});
const opts=(rows,value,label,id='id')=>'<option value="">Choose…</option>'+list(rows).map(r=>'<option value="'+esc(r[id])+'" '+(r[id]===value?'selected':'')+'>'+esc(label(r))+'</option>').join('');

export function attachAssessmentContext(host){
 let node=null,workspace=null,state=null,catalog=null,options=null,edition=null,draft=empty();
 let controller=null,epoch=0,busy=false,error='',message='',requests=[],currentTask=null,selectedEdition=null;
 let selectedPolygon='',query='',page=0,taskFingerprint='';
 let parcelEdition=null,selectedParcelEdition=null,parcelQuery='',parcelPage=0;
 let optionsRequest=0,editionRequest=0,parcelRequest=0,pendingEdition=null,optionsLoading=false;
 let reportDelivery='',reportReady=null;
 const parcelActions=new Set(['assessment.context.parcels','assessment.context.receive_parcels']);
 const read=(operation,value={})=>host.api('/api/assessment-context/'+operation,{method:'POST',body:{workspace,...value},signal:controller?.signal});
 function persist(){
  if(!workspace)return;
  try{sessionStorage.setItem('assessment-context:'+workspace,JSON.stringify({draft,requests:requests.slice(-30),currentTask,selectedEdition,selectedPolygon,query,page,selectedParcelEdition,parcelQuery,parcelPage,reportDelivery,reportReady}));}catch{}
 }
 function restore(){
  draft=empty();requests=[];currentTask=null;selectedEdition=null;selectedPolygon='';query='';page=0;selectedParcelEdition=null;parcelQuery='';parcelPage=0;reportDelivery='';reportReady=null;
  try{const v=JSON.parse(sessionStorage.getItem('assessment-context:'+workspace)||'{}');draft={...draft,...(v.draft||{})};
   requests=list(v.requests);currentTask=v.currentTask||null;selectedEdition=v.selectedEdition||null;
   selectedPolygon=v.selectedPolygon||'';query=v.query||'';page=Number(v.page)||0;
   selectedParcelEdition=v.selectedParcelEdition||null;parcelQuery=v.parcelQuery||'';parcelPage=Number(v.parcelPage)||0;
   reportDelivery=v.reportDelivery||'';reportReady=v.reportReady||null;}catch{}
 }
 function fail(e){if(e?.name==='AbortError')return;error=e?.message||String(e);message='';notice();}
 function notice(){const t=node?.querySelector('[data-ac-notice]');if(t){t.textContent=error||message;t.className=error?'ac-notice ac-error':'ac-notice';}}

 function table(reference){return list(options?.tables).find(r=>key(r.reference)===key(reference));}
 function inventory(t){return {table:ref(t.reference),fields:{...(t.default_fields||{})},assessment:{...empty().assessment,...(t.assessment_defaults||{})}};}
 function selectedInventories(){return list(draft.inventories).filter(item=>table(item.table));}
 function filterInput(category,field,label){
  const values=new Set();
  for(const item of selectedInventories()){
   const t=table(item.table),column=item.fields[field];
   if(column)for(const value of list(t.values?.[column]))values.add(value);
   else if(field==='assessment_edition')values.add(String(item.assessment.vintage||''));
   else if(field==='support')values.add('');
  }
  if(!values.size)return '';
  return '<label>'+esc(label)+'<select multiple size="'+Math.min(6,Math.max(2,values.size))+'" data-ac-filter="'+category+'">'+
   [...values].sort().map(v=>'<option value="'+esc(v)+'" '+(list(draft.filters[category]).includes(v)?'selected':'')+'>'+esc(v||'(not reported in this original field)')+'</option>').join('')+
   '</select><small>Leave unselected to include every original value. Filters match the same original row.</small></label>';
 }
 function renderForm(){
  const target=node?.querySelector('[data-ac-form-area]');if(!target)return;
  const chosen=selectedInventories();
  for(const item of chosen){const t=table(item.table);for(const name of list(t.assessment_locked_fields))item.assessment[name]=t.assessment_defaults[name];}
  const fields=['watershed','cause','use','county','support','assessment_edition','assessment_title','assessment_status','assessment_vintage','assessment_reference'];
  const cards=list(options?.tables).map(t=>{
   const identity=key(t.reference),item=chosen.find(row=>key(row.table)===identity);
   return '<section class="ac-inventory"><label class="ac-check"><input type="checkbox" data-ac-inventory-toggle="'+esc(identity)+'" '+(item?'checked':'')+'>'+
    '<span>'+esc(t.title)+'<small>'+t.row_count+' original rows · '+esc(t.assessment_defaults?.status||'source status requires a binding')+' · '+esc(t.vintage)+' · '+esc(t.reference.source_id)+'</small></span></label>'+
    (item?'<details><summary>Original field bindings and source metadata</summary><div class="ac-fields">'+fields.map(f=>'<label>'+esc(f)+' field<select '+(['watershed','cause','use'].includes(f)?'required':'')+' data-ac-inventory="'+esc(identity)+'" data-ac-binding="'+f+'">'+
       '<option value="">'+(['watershed','cause','use'].includes(f)?'Choose…':'Omit')+'</option>'+list(t.fields).map(v=>'<option value="'+esc(v)+'" '+(item.fields[f]===v?'selected':'')+'>'+esc(v)+'</option>').join('')+'</select></label>').join('')+'</div>'+
      '<div class="ac-fields">'+['title','status','vintage','reference'].map(f=>'<label>Assessment '+esc(f)+'<input required '+(list(t.assessment_locked_fields).includes(f)?'readonly aria-readonly="true"':'')+' data-ac-inventory="'+esc(identity)+'" data-ac-assessment="'+f+'" value="'+esc(item.assessment[f])+'"></label>').join('')+'</div>'+
      '<p class="ac-explanation">Source metadata stays attached to this inventory; original row fields retain their specific editions and support. Context title is editable. Original SHA256 '+esc(t.source_sha256)+'.</p></details>':'')+'</section>';
  }).join('');
  target.innerHTML='<form data-ac-form><div class="ac-fields"><label>Saved original station study<select required data-ac-field="station_geography_id">'+
   opts(catalog?.geographies,draft.station_geography_id,r=>r.title+' · '+(r.summary?.station_count??0)+' stations')+'</select></label>'+
   '<label>Original watershed source<select required data-ac-watershed>'+opts(list(options?.watershed_sources).map(r=>({...r,id:key(r.reference)})),key(draft.watershed_source),r=>r.title)+'</select></label>'+
   '<label>Association used for context<select data-ac-field="relationship_basis"><option value="published_watershed" '+(draft.relationship_basis==='published_watershed'?'selected':'')+'>Original assessment watershed label</option>'+
   '<option value="station_membership" '+(draft.relationship_basis==='station_membership'?'selected':'')+'>Computed station / polygon membership</option></select></label></div>'+
   '<h3>Original assessment inventories</h3>'+(optionsLoading?'<p>Loading the selected study’s retained inventories…</p>':'')+'<p>'+chosen.length+' selected inventories · '+chosen.reduce((sum,item)=>sum+(table(item.table)?.row_count||0),0)+' original rows before filters.</p>'+cards+
   '<p class="ac-explanation">Each source retains its edition, status, cause, use and support. A station listing supplies geographic context for a polygon. Both original published and computed geographic relationships remain in the saved result.</p>'+
   '<div class="ac-fields">'+filterInput('causes','cause','Original causes')+filterInput('uses','use','Original uses')+filterInput('supports','support','Original use support')+filterInput('counties','county','Original counties')+filterInput('editions','assessment_edition','Original assessment editions')+'</div>'+
   '<label>Context title<input required data-ac-field="title" value="'+esc(draft.title)+'"></label>'+
   '<div class="ac-toolbar"><button type="submit" '+(busy||optionsLoading||!chosen.length?'disabled':'')+'>Prepare geographic context</button>'+btn('reload','Refresh retained studies')+'</div></form>';
 }
 async function loadOptions(id,preserve=false){
  const gen=epoch,keyNow=workspace,request=++optionsRequest;options=null;optionsLoading=Boolean(id);renderForm();if(!id){options=null;draft.inventories=[];renderForm();return;}
  try{const value=await read('options',{geography_id:id});if(gen!==epoch||keyNow!==workspace||request!==optionsRequest)return;
   options=value;optionsLoading=false;draft.station_geography_id=id;
   if(preserve&&!list(draft.inventories).length&&draft.table)
    draft.inventories=[{table:draft.table,fields:draft.fields,assessment:draft.assessment}];
   draft.inventories=preserve?list(draft.inventories).filter(item=>table(item.table)):list(value.tables).map(inventory);
   if(!draft.inventories.length)draft.inventories=list(value.tables).map(inventory);
   delete draft.table;delete draft.fields;delete draft.assessment;
   if(!preserve||!list(value.watershed_sources).some(t=>key(t.reference)===key(draft.watershed_source)))
    draft.watershed_source=value.watershed_sources[0]?ref(value.watershed_sources[0].reference):null;
   persist();renderForm();}catch(e){if(gen===epoch&&request===optionsRequest){optionsLoading=false;fail(e);renderForm();}}
 }
 async function loadCatalog(initial=false){
  const gen=epoch;
  try{const value=await read('catalog');if(gen!==epoch)return;catalog=value;
   node.querySelector('[data-ac-editions]').innerHTML=opts(value.editions,selectedEdition,r=>r.title+' · '+r.summary.assessment_row_count+' rows');
   if(initial){if(!draft.station_geography_id&&value.geographies.length)draft.station_geography_id=value.geographies[value.geographies.length-1].id;
    await loadOptions(draft.station_geography_id,true);if(gen!==epoch)return;if(selectedEdition)await openEdition(selectedEdition);}
   else renderForm();
   if(gen!==epoch)return;if(initial&&selectedParcelEdition)await openParcels(selectedParcelEdition);
   if(gen!==epoch)return;renderParcels();renderParcelResult();await openPendingEdition();}catch(e){if(gen===epoch)fail(e);}
 }
 async function openEdition(id){
  const gen=epoch,request=++editionRequest;
  try{const value=await read('edition',{id});if(gen!==epoch||request!==editionRequest)return;edition=value;selectedEdition=id;
   if(!list(value.geojson?.features).some(f=>f.id===selectedPolygon))selectedPolygon='';
   node.querySelector('[data-ac-editions]').value=id;persist();renderResult();}catch(e){if(gen===epoch&&request===editionRequest)fail(e);}
 }
 function rows(){
  const term=query.toLowerCase();
  return list(edition?.result?.rows).filter(r=>(!selectedPolygon||list(r.selected_polygon_ids).includes(selectedPolygon))&&
    (!term||[r.station_id,r.cause,r.impaired_use,r.use_support,r.assessment_edition,r.original_watershed_value,JSON.stringify(r.original)].join(' ').toLowerCase().includes(term)));
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
   '<div class="ac-table-wrap"><table><thead><tr><th>Station / original row</th><th>Original cause / use / edition</th><th>Published watershed</th><th>Computed membership</th><th>Source detail</th></tr></thead><tbody>'+
   shown.map(r=>'<tr><td>'+esc(r.station_id)+'<small>row '+r.row_number+' · '+esc(r.location_status)+'</small></td><td>'+esc(r.cause)+' / '+esc(r.impaired_use)+
    '<small>'+esc(r.use_support??'not reported')+' · '+esc(r.assessment_edition??'')+' · '+esc(r.assessment?.status)+' · '+esc(r.assessment?.vintage)+'</small></td><td>'+esc(r.original_watershed_value)+'<small>'+esc(r.geographic_status)+'</small></td><td>'+list(r.computed_memberships).map(m=>esc(m.watershed_id)+' ('+esc(m.relation)+')').join('<br>')+
    '<small>'+(r.association_agreement===true?'Associations agree':r.association_agreement===false?'Associations differ':'Comparison unresolved')+'</small></td><td><details><summary>Original fields and references</summary><pre>'+esc(JSON.stringify({assessment:r.assessment,edition:r.assessment_edition,original_edition_source:r.original_edition_source,assessment_record_id:r.assessment_record_id,original:r.original,source:r.source_ref,computed:r.computed_memberships},null,2))+'</pre></details></td></tr>').join('')+
   '</tbody></table></div><div class="ac-toolbar">'+btn('previous','Previous',page===0?'disabled':'')+'<span>Page '+(page+1)+' of '+Math.max(1,Math.ceil(filtered.length/40))+'</span>'+
   btn('next','Next',(page+1)*40>=filtered.length?'disabled':'')+'</div>';
 }
 async function openParcels(id){
  const gen=epoch,request=++parcelRequest;
  try{const value=await read('parcels',{id});if(gen!==epoch||request!==parcelRequest)return;
   parcelEdition=value;selectedParcelEdition=id;persist();renderParcelResult();}catch(e){if(gen===epoch&&request===parcelRequest)fail(e);}
 }
 function parcelRows(){
  const term=parcelQuery.toLowerCase();
  return list(parcelEdition?.result?.rows).filter(r=>!term||[r.parcel_id,r.label,r.association_status,
    list(r.station_ids).join(' '),JSON.stringify(r.original_parcel_attributes)].join(' ').toLowerCase().includes(term));
 }
 function reportControls(contextId,parcelId=null){
  const ready=reportReady?.context_id===contextId&&(reportReady.parcel_id||null)===(parcelId||null);
  return '<section class="ac-report"><h3>Scientific and client report</h3><label>Keep an existing report selection<select data-ac-report-delivery>'+
   '<option value="">New report selection</option>'+list(state?.data?.deliveries).map(row=>'<option value="'+esc(row.id)+'" '+(row.id===reportDelivery?'selected':'')+'>'+esc(row.title||row.id)+'</option>').join('')+'</select></label>'+
   '<div class="ac-toolbar">'+btn('prepare-report','Use saved '+(parcelId?'parcel and assessment':'assessment')+' context in report',
    'data-context="'+esc(contextId)+'" data-parcel="'+esc(parcelId||'')+'" '+(busy?'disabled':''))+
   (ready?btn('open-report','Open prepared report form'):'')+'</div>'+
   '<p>The complete saved selection and original packages become one ordered scientific source. Existing native runs and previously selected studies remain in the chosen report. Current table searches do not replace the saved selection.</p></section>';
 }
 function acceptReport(task){
  if(task?.workspace!==workspace||task?.action!=='assessment.context.report'||task.state!=='complete'||
     !task.result?.source||!task.result?.delivery_selection)return;
  reportReady=clone(task.result);persist();renderResult();renderParcelResult();
 }
 async function openReport(value){
  if(!value?.source||!value?.delivery_selection)throw Error('Finish the retained assessment report-source operation first.');
  await host.openDelivery(clone(value.delivery_selection));
 }
 function renderParcels(){
  const target=node?.querySelector('[data-ac-parcels]');if(!target)return;
  if(!edition){target.innerHTML='';return;}
  target.innerHTML='<h3>Associate original parcels with this context</h3><p>Measure polygon overlap within each original parcel study reporting boundary. Results preserve original parcel IDs and assessment rows, with area overlaps and boundary-only contacts shown separately.</p>'+
   '<div class="ac-toolbar"><label>Saved original parcel study<select data-ac-parcel-study>'+opts(catalog?.parcel_studies,'',r=>r.title+' · '+r.state)+'</select></label>'+
   btn('parcels','Prepare parcel associations',busy||!list(catalog?.parcel_studies).length?'disabled':'')+'</div>'+
   (!list(catalog?.parcel_studies).length?'<p>Create or receive a parcel study in Conservation plans to calculate these associations.</p>':'')+
   '<details><summary>Exact geographic context source</summary><pre>'+esc(JSON.stringify(edition.context_source_binding,null,2))+'</pre></details>';
 }
 function renderParcelRows(){
  const target=node?.querySelector('[data-ac-parcel-rows]');if(!target)return;
  const filtered=parcelRows();parcelPage=Math.max(0,Math.min(parcelPage,Math.ceil(filtered.length/40)-1));
  target.innerHTML='<div class="ac-toolbar"><span>'+filtered.length+' original parcels</span>'+btn('export-parcels','Download filtered parcel CSV')+'</div>'+
   '<div class="ac-table-wrap"><table><thead><tr><th>Original parcel</th><th>Association</th><th>Area within reporting boundary (ha)</th><th>Context overlap (ha / fraction)</th><th>Stations / rows</th><th>Original detail</th></tr></thead><tbody>'+
   filtered.slice(parcelPage*40,parcelPage*40+40).map(r=>'<tr><td>'+esc(r.parcel_id)+'<small>'+esc(r.label)+'</small></td><td>'+esc(r.association_status)+
   '</td><td>'+esc(r.reporting_parcel_area_ha)+'</td><td>'+esc(r.context_overlap_area_ha)+' / '+esc(r.reporting_context_fraction)+
   '</td><td>'+r.station_count+' / '+r.assessment_row_count+'</td><td><details><summary>Original attributes and assessment associations</summary><pre>'+
   esc(JSON.stringify({parcel:r,relationships:list(parcelEdition.result.relationships).filter(x=>x.parcel_id===r.parcel_id),
     assessment_rows:list(parcelEdition.result.assessment_rows).filter(x=>r.assessment_row_ids?list(r.assessment_row_ids).includes(x.assessment_row_id):list(r.assessment_row_numbers).includes(x.row_number))},null,2))+
   '</pre></details></td></tr>').join('')+'</tbody></table></div><div class="ac-toolbar">'+
   btn('parcel-previous','Previous',parcelPage===0?'disabled':'')+'<span>Page '+(parcelPage+1)+' of '+Math.max(1,Math.ceil(filtered.length/40))+'</span>'+
   btn('parcel-next','Next',(parcelPage+1)*40>=filtered.length?'disabled':'')+'</div>';
 }
 function renderParcelResult(){
  const choices=node?.querySelector('[data-ac-parcel-editions]');
  if(choices)choices.innerHTML=opts(catalog?.parcel_editions,selectedParcelEdition,r=>r.title+' · '+r.summary.parcel_count+' parcels');
  const target=node?.querySelector('[data-ac-parcel-result]');if(!target)return;
  if(!parcelEdition){target.innerHTML='<p>Select a retained parcel association, prepare one from a context, or receive its complete package.</p>';return;}
  const r=parcelEdition.result,s=parcelEdition.summary;
  target.innerHTML='<h3>'+esc(parcelEdition.title)+'</h3><p>'+esc(r.assessment.title)+' · '+esc(r.assessment.status)+' · '+esc(r.assessment.vintage)+'</p>'+
    '<p>'+esc(r.relation)+'</p><p>'+esc(r.method)+'. '+esc(r.score_effect)+'</p>'+
    '<div class="ac-summary">'+[['Parcels',s.parcel_count],['Area associations',s.area_association_parcel_count],
      ['Boundary-only contacts',s.boundary_contact_parcel_count],['No selected context intersection',s.without_selected_context_count],
      ['Relationships',s.relationship_count]].map(([k,v])=>'<div><strong>'+v+'</strong><span>'+esc(k)+'</span></div>').join('')+'</div>'+
    (parcelEdition.received_from?'<p>Received saved result. Its original study selection and native sources are retained. Select a destination parcel study to calculate a new association.</p>':'')+
    '<label class="ac-search">Find original parcel, station, association or source text<input data-ac-parcel-search value="'+esc(parcelQuery)+'"></label>'+
    '<div data-ac-parcel-rows></div><h4>Complete parcel association exports</h4><div class="ac-downloads">'+
    list(parcelEdition._downloads).map(f=>'<a href="'+esc(f.url)+'" download="'+esc(f.filename)+'">'+esc(f.filename)+'</a>').join('')+'</div>';
  target.insertAdjacentHTML('beforeend',reportControls(parcelEdition.context_id,parcelEdition.id));
  renderParcelRows();
 }
 function downloadCsv(headers,rows,filename){
  const cell=v=>{let t=v==null?'':typeof v==='object'?JSON.stringify(v):String(v);if(/^[=+\-@\t\r]/.test(t))t="'"+t;return '"'+t.replace(/"/g,'""')+'"';};
  const text=[headers.join(','),...rows.map(r=>headers.map(k=>cell(r[k])).join(','))].join('\r\n')+'\r\n';
  const url=URL.createObjectURL(new Blob([text],{type:'text/csv;charset=utf-8'})),a=document.createElement('a');
  a.href=url;a.download=filename;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
 }
 function renderResult(){
  const result=node?.querySelector('[data-ac-result]');if(!result)return;
  if(!edition){result.innerHTML='<p>Prepare a context from a retained station study or receive a complete context package.</p>';return;}
  const r=edition.result,s=edition.summary,a=r.assessment;
  result.innerHTML='<h2>'+esc(edition.title)+'</h2><p><strong>'+esc(a.title)+' · '+esc(a.status)+' · '+esc(a.vintage)+'</strong></p>'+
   '<p>'+esc(r.relation)+'</p><div class="ac-toolbar">'+btn('use-context','Use this saved selection for a new context')+'</div><div class="ac-summary">'+[['Inventories',s.inventory_count??1],['Stations',s.station_count],['Assessment rows',s.assessment_row_count],['Watersheds',s.watershed_count],
    ['Unmatched rows',s.unmatched_row_count],['Multiple associations',s.multiple_association_row_count],['Different associations',s.differing_association_row_count],['Unresolved comparisons',s.unresolved_comparison_row_count]].map(([k,v])=>'<div><strong>'+v+'</strong><span>'+esc(k)+'</span></div>').join('')+'</div>'+
   '<p>Association basis: '+esc(r.relationship_basis)+'. Original records: '+sourceLinks(r)+'</p>'+
   '<details><summary>Original assessment editions and cause/use groups</summary><pre>'+esc(JSON.stringify(r.assessment_groups,null,2))+'</pre></details><div data-ac-map class="ac-map"></div><label class="ac-search">Find original station, cause, watershed or source text<input data-ac-search value="'+esc(query)+'"></label>'+
   '<div data-ac-rows></div><section data-ac-parcels></section><h3>Complete source and editable package</h3><div class="ac-downloads">'+
   list(edition._downloads).filter(f=>f.filename!=='started.json'&&f.filename!=='original-station-geography.zip').map(f=>'<a href="'+esc(f.url)+'" download="'+esc(f.filename)+'">'+esc(f.filename)+'</a>').join('')+'</div>';
  result.insertAdjacentHTML('beforeend',reportControls(edition.id));
  renderMap();renderRows();renderParcels();
 }
 function exportRows(){
  const headers=['station_id','row_number','assessment_row_id','cause','impaired_use','county','use_support','original_watershed_value','location_status','watershed_status','geographic_status','association_agreement','association_status',
    'published_polygon_ids','computed_polygon_ids','selected_polygon_ids','assessment','assessment_edition','assessment_record_id','original_edition_source','source_ref','original'];
  const cell=v=>{let t=v==null?'':typeof v==='object'?JSON.stringify(v):String(v);if(/^[=+\-@\t\r]/.test(t))t="'"+t;return '"'+t.replace(/"/g,'""')+'"';};
  const text=[headers.join(','),...rows().map(r=>headers.map(k=>cell(r[k])).join(','))].join('\r\n')+'\r\n';
  const url=URL.createObjectURL(new Blob([text],{type:'text/csv;charset=utf-8'})),a=document.createElement('a');
  a.href=url;a.download='assessment-context-filtered.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
 }
 function ownedTasks(){return list(state?.tasks).filter(t=>String(t.action||'').startsWith('assessment.context.')&&(!t.workspace||t.workspace===workspace));}
 function renderTasks(){
  const target=node?.querySelector('[data-ac-tasks]');if(!target)return;
  target.innerHTML=ownedTasks().slice(-15).reverse().map(t=>'<div class="ac-task">'+btn('task',t.action+' · '+t.state,'data-id="'+esc(t.id)+'"')+
   (t.state==='complete'&&t.action==='assessment.context.report'&&t.result?.source?btn('report-task','Open report form','data-id="'+esc(t.id)+'"'):'')+
   (t.state==='complete'&&t.result?.id?btn('open-result','Open saved result','data-id="'+esc(t.result.id)+'" data-parcels="'+(parcelActions.has(t.action)?'1':'0')+'"'):'')+(t.error?'<span>'+esc(t.error.message||t.error)+'</span>':'')+'</div>').join('')||'<p>Operations appear here after submission. They remain in the original queue when this desk closes.</p>';
 }
 async function submit(action,payload){
  if(busy)return;const workspaceNow=workspace,gen=epoch,requestKey=canonical({workspace,action,payload});
  let request=requests.find(r=>r.key===requestKey);if(!request){request={key:requestKey,id:'assessment-context-'+crypto.randomUUID()};requests.push(request);}
  busy=true;error='';message='Saving this source selection in the original task queue…';persist();notice();
  try{const t=await host.api('/api/actions',{method:'POST',body:{workspace,action,payload,operation_id:request.id}});
   if(workspaceNow!==workspace||gen!==epoch)return;currentTask=t.id;persist();await host.refresh({force:true});if(gen!==epoch||workspaceNow!==workspace)return;state=host.getState();
   message='Context operation '+t.state+'.';renderTasks();acceptReport(t);notice();
   if(t.state==='complete'&&t.result?.id){await loadCatalog();if(gen!==epoch||workspaceNow!==workspace)return;if(parcelActions.has(action))await openParcels(t.result.id);else await openEdition(t.result.id);}
  }catch(e){if(workspaceNow===workspace&&gen===epoch)fail(e);}finally{if(workspaceNow===workspace&&gen===epoch){busy=false;renderForm();renderParcels();renderResult();renderParcelResult();}}
 }
 function edit(event){
  const t=event.target,item=list(draft.inventories).find(row=>key(row.table)===t.dataset.acInventory);
  if(t.matches('[data-ac-field]'))draft[t.dataset.acField]=t.value;
  if(item&&t.matches('[data-ac-assessment]')&&!list(table(item.table)?.assessment_locked_fields).includes(t.dataset.acAssessment))item.assessment[t.dataset.acAssessment]=t.value;
  if(t.matches('[data-ac-filter]'))draft.filters[t.dataset.acFilter]=[...t.selectedOptions].map(o=>o.value);
  if(item&&t.matches('[data-ac-binding]')){if(t.value)item.fields[t.dataset.acBinding]=t.value;else delete item.fields[t.dataset.acBinding];}
  persist();
 }
 async function change(event){
  edit(event);const t=event.target;
  if(t.matches('[data-ac-report-delivery]')){reportDelivery=t.value;persist();renderResult();renderParcelResult();return;}
  if(t.matches('[data-ac-field="station_geography_id"]')){draft.filters=empty().filters;await loadOptions(t.value);}
  else if(t.matches('[data-ac-inventory-toggle]')){
   const identity=t.dataset.acInventoryToggle,found=list(options?.tables).find(row=>key(row.reference)===identity);
   draft.inventories=list(draft.inventories).filter(row=>key(row.table)!==identity);
   if(t.checked&&found)draft.inventories.push(inventory(found));
   draft.filters=empty().filters;persist();renderForm();
  }
  else if(t.matches('[data-ac-watershed]')){const row=list(options?.watershed_sources).find(r=>key(r.reference)===t.value);draft.watershed_source=row?ref(row.reference):null;persist();}
  else if(t.matches('[data-ac-binding]')){draft.filters=empty().filters;persist();renderForm();}
  else if(t.matches('[data-ac-editions]')&&t.value)await openEdition(t.value);
  else if(t.matches('[data-ac-parcel-editions]')&&t.value)await openParcels(t.value);
  else if(t.matches('[data-ac-receive],[data-ac-receive-parcels]')&&t.files[0]){
   const gen=epoch,workspaceNow=workspace;
   try{const file=t.files[0],upload=await host.api('/api/upload',{method:'POST',raw:file,filename:file.name});
    if(workspaceNow===workspace&&gen===epoch)await submit(t.matches('[data-ac-receive-parcels]')?'assessment.context.receive_parcels':'assessment.context.receive',{upload_id:upload.id});}catch(e){if(gen===epoch)fail(e);}
  }
 }
 async function click(event){
  const polygon=event.target.closest('[data-ac-polygon]');
  if(polygon){selectedPolygon=polygon.dataset.acPolygon;page=0;persist();renderMap();renderRows();return;}
  const t=event.target.closest('[data-ac-action]');if(!t)return;
  const a=t.dataset.acAction;
  if(a==='prepare-report'){
   await submit('assessment.context.report',{context_id:t.dataset.context,...(t.dataset.parcel?{parcel_id:t.dataset.parcel}:{}),
    ...(reportDelivery?{delivery_id:reportDelivery}:{})});
  }
  else if(a==='open-report'){try{await openReport(reportReady);}catch(e){fail(e);}}
  else if(a==='report-task'){
   const task=ownedTasks().find(task=>task.id===t.dataset.id);
   try{await openReport(task?.result);}catch(e){fail(e);}
  }
  else if(a==='use-context'&&edition){draft={...empty(),...clone(edition.selection||edition.result.selection)};await loadOptions(draft.station_geography_id,true);persist();}
  else if(a==='open-result'){if(t.dataset.parcels==='1')await openParcels(t.dataset.id);else await openEdition(t.dataset.id);}
  else if(a==='reload'){await loadCatalog();await loadOptions(draft.station_geography_id,true);}
  else if(a==='clear-polygon'){selectedPolygon='';page=0;persist();renderMap();renderRows();}
  else if(a==='previous'||a==='next'){page+=a==='previous'?-1:1;persist();renderRows();}
  else if(a==='export-rows')exportRows();
  else if(a==='task')host.showTask(t.dataset.id);
  else if(a==='parcel-previous'||a==='parcel-next'){parcelPage+=a==='parcel-previous'?-1:1;persist();renderParcelRows();}
  else if(a==='export-parcels')downloadCsv(['parcel_id','label','association_status','full_parcel_area_ha','reporting_parcel_area_ha','context_overlap_area_ha','reporting_context_fraction','context_ids','station_ids','assessment_row_numbers','assessment_row_ids','original_parcel_attributes'],parcelRows(),'assessment-parcel-context-filtered.csv');
  else if(a==='parcels'){
   const study=node.querySelector('[data-ac-parcel-study]')?.value;
   if(!study){fail(new Error('Choose an original parcel study.'));return;}
   await submit('assessment.context.parcels',{context_id:edition.id,study_id:study});
  }
 }

 async function openPendingEdition(){
  const target=pendingEdition;
  if(!target||!node||!catalog||target.workspace!==workspace)return;
  if(target.parcels)await openParcels(target.id);else await openEdition(target.id);
  if(pendingEdition===target)pendingEdition=null;
 }
 function taskActions(task){
  const current=host.getWorkspace()||host.getState()?.workspace_key;
  if(task?.state==='complete'&&task.action==='assessment.context.report'&&task.workspace===current&&task.result?.source){
   return '<button type="button" data-action="assessment-context-report-open" data-workspace="'+esc(task.workspace)+
    '" data-task="'+esc(task.id)+'">Open assessment report form</button>';
  }
  if(task?.state!=='complete'||!String(task.action||'').startsWith('assessment.context.')||
     task.workspace!==current||!/^[a-f0-9]{64}$/.test(String(task.result?.id||'')))return '';
  return '<button type="button" data-action="assessment-context-result-open" data-workspace="'+esc(task.workspace)+
   '" data-id="'+esc(task.result.id)+'" data-parcels="'+(parcelActions.has(task.action)?'1':'0')+'">Open assessment context result</button>';
 }
 async function dispatch(button){
  if(button?.dataset?.action==='assessment-context-report-open'){
   const keyNow=host.getWorkspace()||host.getState()?.workspace_key;
   if(!keyNow||button.dataset.workspace!==keyNow)throw Error('Open the original report-source Workspace first.');
   const task=list(host.getState()?.tasks).find(item=>item.id===button.dataset.task&&item.workspace===keyNow);
   if(task?.state!=='complete'||task.action!=='assessment.context.report')throw Error('Open the completed original report-source task.');
   host.closeDetail();await openReport(task.result);return true;
  }
  if(button?.dataset?.action!=='assessment-context-result-open')return false;
  const keyNow=host.getWorkspace()||host.getState()?.workspace_key;
  if(!keyNow||button.dataset.workspace!==keyNow||!/^[a-f0-9]{64}$/.test(String(button.dataset.id||'')))
   throw Error('Open the original task Workspace before opening its assessment result.');
  pendingEdition={workspace:keyNow,id:button.dataset.id,parcels:button.dataset.parcels==='1'};
  host.closeDetail();host.navigate('assessment-context');await openPendingEdition();return true;
 }

 function mount(container,initial=host.getState()){
  detach();node=container;state=initial;workspace=host.getWorkspace()||state?.workspace_key;controller=new AbortController();epoch++;restore();if(pendingEdition&&pendingEdition.workspace!==workspace)pendingEdition=null;
  node.innerHTML='<section class="ac-desk"><header><h1>Assessment geographic context</h1><p>Original assessment records, watershed association and parcel context in one retained source edition.</p></header>'+
   '<p data-ac-notice class="ac-notice" aria-live="polite"></p><details open><summary>Prepare from a saved station study</summary><div data-ac-form-area></div></details>'+
   '<section class="ac-toolbar"><label>Saved context<select data-ac-editions></select></label><label>Receive complete context ZIP<input type="file" accept=".zip" data-ac-receive></label></section>'+
   '<section data-ac-result></section><section><h2>Saved parcel associations</h2><div class="ac-toolbar"><label>Saved parcel result<select data-ac-parcel-editions></select></label><label>Receive complete parcel context ZIP<input type="file" accept=".zip" data-ac-receive-parcels></label></div><div data-ac-parcel-result></div></section><section><h2>Retained operations</h2><div data-ac-tasks></div></section></section>';
  const signal=controller.signal;node.addEventListener('input',e=>{if(e.target.matches('[data-ac-search]')){query=e.target.value;page=0;persist();renderRows();}else if(e.target.matches('[data-ac-parcel-search]')){parcelQuery=e.target.value;parcelPage=0;persist();renderParcelRows();}else edit(e);},{signal});
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
   acceptReport(t);
   if(t?.state==='complete'&&t.result?.id){
    if(parcelActions.has(t.action)&&t.result.id!==selectedParcelEdition){loadCatalog();openParcels(t.result.id);}
    else if(!parcelActions.has(t.action)&&t.result.id!==selectedEdition){loadCatalog();openEdition(t.result.id);}
   }
   if(['failed','interrupted','cancelled'].includes(t?.state)&&t.error)fail(t.error);
  }
 }
 function detach(){persist();controller?.abort();controller=null;epoch++;node=null;edition=null;parcelEdition=null;options=null;catalog=null;busy=false;optionsLoading=false;}
 return {mount,update,detach,taskActions,dispatch};
}
