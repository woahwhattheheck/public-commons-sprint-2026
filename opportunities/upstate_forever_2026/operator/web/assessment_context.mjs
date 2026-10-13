/** Assessment geographic context on the original operator and retained task queue. */
const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const list=v=>Array.isArray(v)?v:[];
const sourceLinks=result=>{
 const references=[...new Set(list(result.assessment_groups).map(group=>group.assessment?.reference).filter(value=>typeof value==='string'&&value.trim()))];
 if(!references.length&&result.assessment?.reference)references.push(result.assessment.reference);
 return references.map(reference=>/^https?:\/\/[^\s|]+$/i.test(reference)?'<a href="'+esc(reference)+'" target="_blank" rel="noopener noreferrer">'+esc(reference)+'</a>':esc(reference)).join(' · ');
};
const geographicSources=value=>{
 const sources=list(value?.geographic_context_tables);
 if(!sources.length)return '';
 return '<section class="ac-inventory"><h3>Geographic source context</h3>'+
  '<p>Original station locations and watershed comparisons remain with this saved study. Choose assessment inventories above for cause, use, edition and support.</p>'+
  sources.map(source=>{
   const uri=String(source.uri||''),link=/^https?:\/\/[^\s|]+$/i.test(uri)?
    '<a href="'+esc(uri)+'" target="_blank" rel="noopener noreferrer">Open original source</a>':esc(uri);
   return '<div><strong>'+esc(source.title||source.reference?.source_id||'Original geographic source')+'</strong>'+
    '<p>'+esc(source.row_count)+' retained geographic rows · '+esc(source.vintage||'Source vintage not recorded')+'</p>'+
    '<p>'+link+'</p><details><summary>Retained source identity</summary><p>'+esc(source.reference?.source_id)+
    '</p><p>SHA256 '+esc(source.source_sha256)+'</p></details></div>';
  }).join('')+'</section>';
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

export function comparedAssessmentMemberships(row,selection){
 const source=selection?.watershed_source;
 if(!source?.collection_id||!source?.source_id)return [];
 return list(row?.computed_memberships).filter(member=>member.source_ref?.collection_id===source.collection_id&&member.source_ref?.source_id===source.source_id);
}
export function assessmentMembershipLabels(members){
 return list(members).map(member=>{
  const native=member.watershed_id;
  let label=native==null||native===''?'Not recorded':String(native);
  if(list(members).filter(other=>other.watershed_id===native).length>1){
   const reference=member.source_ref||{};
   label+=' [feature '+(reference.native_feature_id??('index '+String(reference.source_feature_index??'Not recorded')))+']';
  }
  return label+' ('+String(member.relation??'Not recorded')+')';
 });
}
export function assessmentComparisonCounts(rows){
 const values={agree:0,differ:0,unresolved:0};
 for(const row of list(rows))values[row.association_agreement===true?'agree':row.association_agreement===false?'differ':'unresolved']++;
 return values;
}
export function assessmentContextFilteredCSV(rows,selection){
 const headers=['station_id','row_number','assessment_row_id','cause','impaired_use','county','use_support','original_watershed_value','location_status','watershed_status','geographic_status','association_agreement','association_status',
  'compared_watershed_source','compared_watershed_ids','compared_memberships','published_polygon_ids','computed_polygon_ids','selected_polygon_ids','computed_memberships','assessment','assessment_edition','assessment_record_id','original_edition_source','source_ref','original'];
 const cell=v=>{let t=v==null?'':typeof v==='object'?JSON.stringify(v):String(v);if(/^[=+\-@\t\r]/.test(t))t="'"+t;return '"'+t.replace(/"/g,'""')+'"';};
 return [headers.join(','),...list(rows).map(row=>{
  const memberships=comparedAssessmentMemberships(row,selection),record={...row,compared_watershed_source:selection?.watershed_source??null,compared_watershed_ids:memberships.map(member=>member.watershed_id),compared_memberships:memberships};
  return headers.map(name=>cell(record[name])).join(',');
 })].join('\r\n')+'\r\n';
}

export function assessmentReportVersion(catalog){
 const version=catalog?.report_version;
 return typeof version==='string'&&version.trim()===version&&version.length>0?version:null;
}
export function assessmentReportRequest(catalog,{context_id,parcel_id,delivery_id}){
 const version=assessmentReportVersion(catalog);
 if(!version)throw Error('Reload Assessment context to load the current report preparation controls.');
 return {context_id,...(parcel_id?{parcel_id}:{}),...(delivery_id?{delivery_id}:{}),report_version:version};
}
export function assessmentReportReady(result,catalog,contextId,parcelId=null,deliveryId=''){
 const version=assessmentReportVersion(catalog);
 return Boolean(version&&result?.version===version&&result.context_id===contextId&&
  (result.parcel_id||null)===(parcelId||null)&&(result.selected_delivery_id||'')===deliveryId);
}

export function attachAssessmentContext(host){
 let node=null,workspace=null,state=null,catalog=null,options=null,edition=null,draft=empty();
 let controller=null,epoch=0,busy=false,error='',message='',requests=[],currentTask=null,selectedEdition=null;
 let selectedPolygon='',query='',page=0,taskFingerprint='';
 let parcelEdition=null,selectedParcelEdition=null,parcelQuery='',parcelPage=0;
 let optionsRequest=0,editionRequest=0,parcelRequest=0,pendingEdition=null,optionsLoading=false;
 let reportDelivery='',reportReady=null,reportPreparing=false,reportPreparationRequest=0;
 let catalogRequest=0,geographyRequest=0,geographyOpening=false,adoptionOpening=null;
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
  target.innerHTML='<form data-ac-form'+(geographyOpening?' inert':'')+'><div class="ac-fields"><label>Saved original station study<select required data-ac-field="station_geography_id">'+
   opts(catalog?.geographies,draft.station_geography_id,r=>r.title+' · '+(r.summary?.station_count??0)+' stations')+'</select></label>'+
   '<label>Original watershed source<select required data-ac-watershed>'+opts(list(options?.watershed_sources).map(r=>({...r,id:key(r.reference)})),key(draft.watershed_source),r=>r.title)+'</select></label>'+
   '<label>Association used for context<select data-ac-field="relationship_basis"><option value="published_watershed" '+(draft.relationship_basis==='published_watershed'?'selected':'')+'>Original assessment watershed label</option>'+
   '<option value="station_membership" '+(draft.relationship_basis==='station_membership'?'selected':'')+'>Computed station / polygon membership</option></select></label></div>'+
   '<h3>Original assessment inventories</h3>'+(optionsLoading?'<p>Loading the selected study’s retained inventories…</p>':'')+
   (options&&!optionsLoading&&!list(options.tables).length?'<p>This saved study has no assessment inventory. Choose a saved assessment study above, or open Station geography to prepare the 87-, 159- or 164-station assessment study.</p>'+btn('open-stations','Open Station geography'):'')+'<p>'+chosen.length+' selected inventories · '+chosen.reduce((sum,item)=>sum+(table(item.table)?.row_count||0),0)+' original rows before filters.</p>'+cards+geographicSources(options)+
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
  const gen=epoch,request=++catalogRequest;
  try{const value=await read('catalog');if(gen!==epoch||request!==catalogRequest)return;catalog=value;
   node.querySelector('[data-ac-editions]').innerHTML=opts(value.editions,selectedEdition,r=>r.title+' · '+r.summary.assessment_row_count+' rows');
   if(initial){if(!draft.station_geography_id&&value.geographies.length)draft.station_geography_id=value.geographies[value.geographies.length-1].id;
    await loadOptions(draft.station_geography_id,true);if(gen!==epoch||request!==catalogRequest)return;if(selectedEdition)await openEdition(selectedEdition);}
   else renderForm();
   if(gen!==epoch||request!==catalogRequest)return;if(initial&&selectedParcelEdition)await openParcels(selectedParcelEdition);
   if(gen!==epoch||request!==catalogRequest)return;renderResult();renderParcels();renderParcelResult();await openPendingEdition();}catch(e){if(gen===epoch&&request===catalogRequest)fail(e);}
 }
 async function openEdition(id){
  cancelGeographyOpening();
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
    '<small>'+esc(r.use_support??'not reported')+' · '+esc(r.assessment_edition??'')+' · '+esc(r.assessment?.status)+' · '+esc(r.assessment?.vintage)+'</small></td><td>'+esc(r.original_watershed_value)+'<small>'+esc(r.geographic_status)+'</small></td><td>'+(assessmentMembershipLabels(comparedAssessmentMemberships(r,edition.selection)).map(esc).join('<br>')||'No retained membership in compared source')+
    '<small>'+(r.association_agreement===true?'Associations agree':r.association_agreement===false?'Associations differ':'Comparison unresolved')+'</small></td><td><details><summary>Original fields and references</summary><pre>'+esc(JSON.stringify({assessment:r.assessment,edition:r.assessment_edition,original_edition_source:r.original_edition_source,assessment_record_id:r.assessment_record_id,original:r.original,source:r.source_ref,computed:r.computed_memberships},null,2))+'</pre></details></td></tr>').join('')+
   '</tbody></table></div><div class="ac-toolbar">'+btn('previous','Previous',page===0?'disabled':'')+'<span>Page '+(page+1)+' of '+Math.max(1,Math.ceil(filtered.length/40))+'</span>'+
   btn('next','Next',(page+1)*40>=filtered.length?'disabled':'')+'</div>';
 }
 async function openParcels(id){
  cancelGeographyOpening();
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
  const ready=assessmentReportReady(reportReady,catalog,contextId,parcelId,reportDelivery);
  return '<section class="ac-report"><h3>Scientific and client report</h3><label>Retain a saved mapped delivery (optional)<select data-ac-report-delivery>'+
   '<option value="">New report selection</option>'+list(state?.data?.deliveries).map(row=>'<option value="'+esc(row.id)+'" '+(row.id===reportDelivery?'selected':'')+'>'+esc(row.title||row.id)+'</option>').join('')+'</select></label>'+
   '<div class="ac-toolbar">'+btn('prepare-report','Use saved '+(parcelId?'parcel and assessment':'assessment')+' context in report',
    'data-context="'+esc(contextId)+'" data-parcel="'+esc(parcelId||'')+'" '+(busy||reportPreparing||!assessmentReportVersion(catalog)?'disabled':''))+
   (ready?btn('open-report','Open scientific report')+btn('open-mapped-report','Open Maps and delivery'):'')+'</div>'+
   '<p>Open the scientific report to arrange the original studies and publish their saved assessment or parcel context. Maps and delivery keeps the chosen native runs and map settings. Both use the complete saved selection and original packages; current table searches do not replace that selection.</p></section>';
 }
 function acceptReport(task){
  if(task?.workspace!==workspace||task?.action!=='assessment.context.report'||task.state!=='complete'||
     !task.result?.source||!task.result?.delivery_selection||
     task.result.version!==assessmentReportVersion(catalog))return;
  reportReady=clone(task.result);persist();renderResult();renderParcelResult();
 }
 async function prepareCurrentReport(contextId,parcelId=null){
  if(busy||reportPreparing)return;
  const gen=epoch,keyNow=workspace,deliveryId=reportDelivery,request=++reportPreparationRequest;
  const active=()=>Boolean(node)&&gen===epoch&&keyNow===workspace&&request===reportPreparationRequest&&
   keyNow===(host.getWorkspace()||host.getState()?.workspace_key);
  reportPreparing=true;renderResult();renderParcelResult();
  try{
   const available=await read('catalog');
   if(!active())return;
   catalog=available;
   if(reportDelivery!==deliveryId||
      (parcelId?(parcelEdition?.id!==parcelId||parcelEdition.context_id!==contextId):edition?.id!==contextId))return;
   const payload=assessmentReportRequest(available,{context_id:contextId,parcel_id:parcelId,delivery_id:deliveryId});
   await submit('assessment.context.report',payload);
  }catch(e){if(active())fail(e);}
  finally{if(active()){reportPreparing=false;renderResult();renderParcelResult();}}
 }
 async function openReport(value,originalWorkspace=workspace,{mapped=false}={}){
  if(!value?.source||!value?.delivery_selection)throw Error('Finish the retained assessment report-source operation first.');
  const current=host.getWorkspace()||host.getState()?.workspace_key;
  if(!originalWorkspace||current!==originalWorkspace)throw Error('Open the original report-source Workspace first.');
  if(mapped){await host.openDelivery(clone(value.delivery_selection));return;}
  const sources=list(value.delivery_selection.observed_context_sources);
  await host.openScientificReport({workspace_key:current,
   sources:clone(sources.length?sources:[value.source]),title:value.title,selection_mode:'replace'});
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
  const r=edition.result,s=edition.summary,a=r.assessment,comparisons=assessmentComparisonCounts(r.rows);
  result.innerHTML='<h2>'+esc(edition.title)+'</h2><p><strong>'+esc(a.title)+' · '+esc(a.status)+' · '+esc(a.vintage)+'</strong></p>'+
   '<p>'+esc(r.relation)+'</p><div class="ac-toolbar">'+btn('use-context','Use this saved selection for a new context')+'</div><div class="ac-summary">'+[['Inventories',s.inventory_count??1],['Stations',s.station_count],['Assessment rows',s.assessment_row_count],['Watersheds',s.watershed_count],
    ['Unmatched rows',s.unmatched_row_count],['Multiple associations',s.multiple_association_row_count],['Agreeing assessments',comparisons.agree],['Different assessments',comparisons.differ],['Unresolved comparisons',comparisons.unresolved]].map(([k,v])=>'<div><strong>'+v+'</strong><span>'+esc(k)+'</span></div>').join('')+'</div>'+
   '<p>Association basis: '+esc(r.relationship_basis)+'. Compared watershed source: '+esc(edition.selection?.watershed_source?.source_id)+' / '+esc(edition.selection?.watershed_source?.collection_id)+'. Original records: '+sourceLinks(r)+'</p>'+
   '<details><summary>Original assessment editions and cause/use groups</summary><pre>'+esc(JSON.stringify(r.assessment_groups,null,2))+'</pre></details><div data-ac-map class="ac-map"></div><label class="ac-search">Find original station, cause, watershed or source text<input data-ac-search value="'+esc(query)+'"></label>'+
   '<div data-ac-rows></div><section data-ac-parcels></section><h3>Complete source and editable package</h3><div class="ac-downloads">'+
   list(edition._downloads).filter(f=>f.filename!=='started.json'&&f.filename!=='original-station-geography.zip').map(f=>'<a href="'+esc(f.url)+'" download="'+esc(f.filename)+'">'+esc(f.filename)+'</a>').join('')+'</div>';
  result.insertAdjacentHTML('beforeend',reportControls(edition.id));
  renderMap();renderRows();renderParcels();
 }
 function exportRows(){
  const text=assessmentContextFilteredCSV(rows(),edition.selection);
  const url=URL.createObjectURL(new Blob([text],{type:'text/csv;charset=utf-8'})),a=document.createElement('a');
  a.href=url;a.download='assessment-context-filtered.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
 }
 function ownedTasks(){return list(state?.tasks).filter(t=>String(t.action||'').startsWith('assessment.context.')&&(!t.workspace||t.workspace===workspace));}
 function renderTasks(){
  const target=node?.querySelector('[data-ac-tasks]');if(!target)return;
  target.innerHTML=ownedTasks().slice(0,15).map(t=>'<div class="ac-task">'+btn('task',t.action+' · '+t.state,'data-id="'+esc(t.id)+'"')+
   (t.state==='complete'&&t.action==='assessment.context.report'&&t.result?.source?btn('report-task','Open scientific report','data-id="'+esc(t.id)+'"'):'')+
   (t.state==='complete'&&t.result?.id?btn('open-result','Open saved result','data-id="'+esc(t.result.id)+'" data-parcels="'+(parcelActions.has(t.action)?'1':'0')+'"'):'')+(t.error?'<span>'+esc(t.error.message||t.error)+'</span>':'')+'</div>').join('')||'<p>Operations appear here after submission. They remain in the original queue when this desk closes.</p>';
 }
 async function submit(action,payload){
  if(busy)return;const workspaceNow=workspace,gen=epoch,requestKey=canonical({workspace,action,payload});
  let request=requests.find(r=>r.key===requestKey);if(!request){request={key:requestKey,id:'assessment-context-'+crypto.randomUUID()};requests.push(request);}
  busy=true;error='';message='Saving this source selection in the original task queue…';persist();notice();
  try{const t=await host.api('/api/actions',{method:'POST',body:{workspace,action,payload,operation_id:request.id}});
   if(workspaceNow!==workspace||gen!==epoch)return;currentTask=t.id;persist();await host.refresh({force:true});if(gen!==epoch||workspaceNow!==workspace)return;state=host.getState();
   message='Context operation '+t.state+'.';renderTasks();acceptReport(t);notice();
   if(t.state==='complete'&&action==='assessment.context.adopt_source'){
    busy=false;await openAdoptedResult(t);
   }else if(t.state==='complete'&&t.result?.id){await loadCatalog();if(gen!==epoch||workspaceNow!==workspace)return;if(parcelActions.has(action))await openParcels(t.result.id);else await openEdition(t.result.id);}
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
   await prepareCurrentReport(t.dataset.context,t.dataset.parcel||null);
  }
  else if(a==='open-report'||a==='open-mapped-report'){try{await openReport(reportReady,workspace,{mapped:a==='open-mapped-report'});}catch(e){fail(e);}}
  else if(a==='report-task'){
   const task=ownedTasks().find(task=>task.id===t.dataset.id);
   try{await openReport(task?.result);}catch(e){fail(e);}
  }
  else if(a==='use-context'&&edition){draft={...empty(),...clone(edition.selection||edition.result.selection)};await loadOptions(draft.station_geography_id,true);persist();}
  else if(a==='open-result'){if(t.dataset.parcels==='1')await openParcels(t.dataset.id);else await openEdition(t.dataset.id);}
  else if(a==='open-stations'){persist();host.navigate('station-geography');}
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

 async function openSavedContext(value){
  const originalWorkspace=host.getWorkspace()||host.getState()?.workspace_key;
  const valid=id=>typeof id==='string'&&/^[a-f0-9]{64}$/.test(id);
  if(!node||!value||value.workspace_key!==workspace||originalWorkspace!==workspace||
     !valid(value.context_id)||(value.parcel_id!=null&&!valid(value.parcel_id)))
   throw Error('Open this saved assessment in its receiving Workspace first.');
  if(busy||reportPreparing)throw Error('Finish submitting the current assessment operation before opening another context.');
  cancelGeographyOpening();
  const gen=epoch,request=++editionRequest,parcelTurn=++parcelRequest,catalogTurn=++catalogRequest;
  ++optionsRequest;pendingEdition=null;currentTask=null;error='';
  const active=()=>Boolean(node)&&gen===epoch&&workspace===originalWorkspace&&
   originalWorkspace===(host.getWorkspace()||host.getState()?.workspace_key)&&
   request===editionRequest&&parcelTurn===parcelRequest&&catalogTurn===catalogRequest;
  message='Opening the original saved assessment and its retained sources…';notice();
  try{
   const [freshCatalog,context,parcels]=await Promise.all([
    read('catalog'),read('edition',{id:value.context_id}),
    value.parcel_id?read('parcels',{id:value.parcel_id}):Promise.resolve(null),
   ]);
   if(!active())return false;
   if(context.id!==value.context_id||!list(freshCatalog.editions).some(row=>row.id===context.id)||
      (parcels&&(parcels.id!==value.parcel_id||parcels.context_id!==context.id)))
    throw Error('The saved assessment or parcel association differs from the selected original records.');
   catalog=freshCatalog;edition=context;selectedEdition=context.id;
   parcelEdition=parcels;selectedParcelEdition=parcels?.id||null;
   selectedPolygon='';query='';page=0;parcelQuery='';parcelPage=0;
   reportReady=null;reportDelivery='';
   node.querySelector('[data-ac-editions]').innerHTML=opts(catalog.editions,selectedEdition,
    row=>row.title+' · '+row.summary.assessment_row_count+' rows');
   renderForm();renderResult();renderParcels();renderParcelResult();persist();
   message='Opened '+context.title+(parcels?' with its saved parcel associations.':'.');notice();
   return {context_id:context.id,parcel_id:parcels?.id||null};
  }catch(problem){if(active()){fail(problem);throw problem;}return false;}
 }
 async function adoptSource(value){
  const originalWorkspace=host.getWorkspace()||host.getState()?.workspace_key;
  const valid=id=>typeof id==='string'&&/^[a-f0-9]{64}$/.test(id);
  if(!node||!value||value.workspace_key!==workspace||originalWorkspace!==workspace||
     !valid(value.source_collection_id)||!valid(value.source_body_sha256)||
     typeof value.source_id!=='string'||!value.source_id)
   throw Error('Choose the retained assessment source in this receiving Workspace.');
  if(busy||reportPreparing)throw Error('Finish submitting the current assessment operation before receiving this source.');
  cancelGeographyOpening();++editionRequest;++parcelRequest;pendingEdition=null;
  await submit('assessment.context.adopt_source',{
   source_collection_id:value.source_collection_id,source_id:value.source_id,
   source_body_sha256:value.source_body_sha256,
  });
 }
 async function openAdoptedResult(task){
  if(task?.action!=='assessment.context.adopt_source'||task.state!=='complete'||task.workspace!==workspace)return false;
  const result=task.result;
  if(!result?.context_id)throw Error('The completed source receiving operation did not retain its assessment context.');
  const key=workspace+':'+task.id;
  if(adoptionOpening?.key===key)return adoptionOpening.promise;
  const opening={key,promise:null};
  adoptionOpening=opening;
  opening.promise=openSavedContext({workspace_key:workspace,context_id:result.context_id,
   ...(result.parcel_id?{parcel_id:result.parcel_id}:{})});
  try{return await opening.promise;}finally{if(adoptionOpening===opening)adoptionOpening=null;}
 }

 function taskActions(task){
  const current=host.getWorkspace()||host.getState()?.workspace_key;
  if(task?.state==='complete'&&task.action==='assessment.context.adopt_source'&&task.workspace===current&&
     /^[a-f0-9]{64}$/.test(String(task.result?.context_id||''))){
   return '<button type="button" data-action="assessment-context-source-open" data-workspace="'+esc(task.workspace)+
    '" data-task="'+esc(task.id)+'">Open received assessment context</button>';
  }
  if(task?.state==='complete'&&task.action==='assessment.context.report'&&task.workspace===current&&task.result?.source){
   return '<button type="button" data-action="assessment-context-report-open" data-workspace="'+esc(task.workspace)+
    '" data-task="'+esc(task.id)+'">Open scientific report</button>'+
     '<button type="button" data-action="assessment-context-report-mapped" data-workspace="'+esc(task.workspace)+
     '" data-task="'+esc(task.id)+'">Open Maps and delivery</button>';
  }
  if(task?.state!=='complete'||!String(task.action||'').startsWith('assessment.context.')||
     task.workspace!==current||!/^[a-f0-9]{64}$/.test(String(task.result?.id||'')))return '';
  return '<button type="button" data-action="assessment-context-result-open" data-workspace="'+esc(task.workspace)+
   '" data-id="'+esc(task.result.id)+'" data-parcels="'+(parcelActions.has(task.action)?'1':'0')+'">Open assessment context result</button>';
 }
 async function dispatch(button){
  if(button?.dataset?.action==='assessment-context-source-open'){
   const keyNow=host.getWorkspace()||host.getState()?.workspace_key;
   if(!keyNow||button.dataset.workspace!==keyNow)throw Error('Open the source receiving Workspace first.');
   const task=list(host.getState()?.tasks).find(item=>item.id===button.dataset.task&&item.workspace===keyNow);
   if(task?.state!=='complete'||task.action!=='assessment.context.adopt_source')
    throw Error('Open the completed original source receiving task.');
   host.closeDetail();
   await host.openDesk('assessment-context','openSavedContext',{workspace_key:keyNow,context_id:task.result.context_id,
    ...(task.result.parcel_id?{parcel_id:task.result.parcel_id}:{})});
   return true;
  }
  if(['assessment-context-report-open','assessment-context-report-mapped'].includes(button?.dataset?.action)){
   const keyNow=host.getWorkspace()||host.getState()?.workspace_key;
   if(!keyNow||button.dataset.workspace!==keyNow)throw Error('Open the original report-source Workspace first.');
   const task=list(host.getState()?.tasks).find(item=>item.id===button.dataset.task&&item.workspace===keyNow);
   if(task?.state!=='complete'||task.action!=='assessment.context.report')throw Error('Open the completed original report-source task.');
   host.closeDetail();await openReport(task.result,keyNow,{mapped:button.dataset.action==='assessment-context-report-mapped'});return true;
  }
  if(button?.dataset?.action!=='assessment-context-result-open')return false;
  const keyNow=host.getWorkspace()||host.getState()?.workspace_key;
  if(!keyNow||button.dataset.workspace!==keyNow||!/^[a-f0-9]{64}$/.test(String(button.dataset.id||'')))
   throw Error('Open the original task Workspace before opening its assessment result.');
  pendingEdition={workspace:keyNow,id:button.dataset.id,parcels:button.dataset.parcels==='1'};
  host.closeDetail();host.navigate('assessment-context');await openPendingEdition();return true;
 }

 function mount(container,initial=host.getState()){
  detach();node=container;state=initial;workspace=host.getWorkspace()||state?.workspace_key;controller=new AbortController();epoch++;reportPreparing=false;reportPreparationRequest++;restore();if(pendingEdition&&pendingEdition.workspace!==workspace)pendingEdition=null;
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
   if(t?.state==='complete'&&t.action==='assessment.context.adopt_source'){
    busy=false;openAdoptedResult(t).catch(fail);
   }else if(t?.state==='complete'&&t.result?.id){
    if(parcelActions.has(t.action)&&t.result.id!==selectedParcelEdition){loadCatalog();openParcels(t.result.id);}
    else if(!parcelActions.has(t.action)&&t.result.id!==selectedEdition){loadCatalog();openEdition(t.result.id);}
   }
   if(['failed','interrupted','cancelled'].includes(t?.state)&&t.error)fail(t.error);
  }
 }

 function cancelGeographyOpening(){
  if(!geographyOpening)return;
  geographyOpening=false;optionsLoading=false;geographyRequest++;
  renderForm();
 }
 async function openForGeography(value){
  const current=host.getWorkspace()||host.getState()?.workspace_key;
  if(!node||!value||value.workspace_key!==workspace||current!==workspace||
     !/^[a-f0-9]{64}$/.test(String(value.geography_id||'')))
   throw Error('Open the saved station study in its original Workspace first.');
  if(busy)throw Error('Finish submitting the current context operation before opening another study.');
  const target=value.geography_id,workspaceNow=workspace,gen=epoch,request=++geographyRequest;
  ++catalogRequest;++optionsRequest;++editionRequest;++parcelRequest;
  currentTask=null;geographyOpening=true;optionsLoading=true;error='';
  message='Opening the saved study and its original assessment inventories…';renderForm();notice();
  const active=()=>Boolean(node)&&workspaceNow===workspace&&gen===epoch&&request===geographyRequest&&
   workspaceNow===(host.getWorkspace()||host.getState()?.workspace_key);
  try{
   const [freshCatalog,available]=await Promise.all([read('catalog'),read('options',{geography_id:target})]);
   if(!active())return false;
   const saved=list(freshCatalog.geographies).find(row=>row.id===target);
   if(!saved||available.geography_id!==target)throw Error('The selected saved station study is absent from this Workspace.');
   const assessmentTables=list(available.tables).filter(row=>Number(row.row_count)>0);
   if(assessmentTables.length&&!list(available.watershed_sources).length)
    throw Error('Build this station study with its retained watershed geometry before preparing assessment context.');
   catalog=freshCatalog;options=available;
   draft={...empty(),title:(available.title||saved.title||'Saved station study')+' — assessment context',
    station_geography_id:target,inventories:assessmentTables.map(inventory),
    watershed_source:available.watershed_sources[0]?ref(available.watershed_sources[0].reference):null};
   edition=null;selectedEdition=null;selectedPolygon='';query='';page=0;
   parcelEdition=null;selectedParcelEdition=null;parcelQuery='';parcelPage=0;
   reportReady=null;reportDelivery='';pendingEdition=null;
   node.querySelector('[data-ac-editions]').innerHTML=opts(catalog.editions,'',row=>row.title+' · '+row.summary.assessment_row_count+' rows');
   optionsLoading=false;geographyOpening=false;persist();renderForm();renderResult();renderParcels();renderParcelResult();
   const count=draft.inventories.reduce((total,item)=>total+Number(table(item.table)?.row_count||0),0);
   message=assessmentTables.length?'Prepared '+draft.inventories.length+' original inventories and '+count+
    ' assessment records from '+(available.title||saved.title)+'. Choose the relationship basis and build the context.':
    'Opened '+(available.title||saved.title)+' with its retained geographic sources. Choose a saved assessment study to prepare cause and use context.';
   notice();node.querySelector('[data-ac-field="title"]')?.focus();
   return {geography_id:target,inventory_count:draft.inventories.length,assessment_record_count:count};
  }catch(problem){if(active()){fail(problem);throw problem;}return false;}
  finally{if(active()&&geographyOpening){geographyOpening=false;optionsLoading=false;renderForm();}}
 }

 function detach(){geographyRequest++;catalogRequest++;geographyOpening=false;persist();controller?.abort();controller=null;epoch++;node=null;edition=null;parcelEdition=null;options=null;catalog=null;busy=false;optionsLoading=false;}
 return {mount,update,detach,taskActions,dispatch,openForGeography,openSavedContext,adoptSource};
}
