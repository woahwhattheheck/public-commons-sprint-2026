/** Original-source selection for Receiving waters. TokenJunkieLabs.
 * Spatial overlays are display geometry only. Saved selections retain native
 * collection/source/layer/feature IDs and exact original attribute values.
 */
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const copy=value=>JSON.parse(JSON.stringify(value));
const object=value=>value&&typeof value==='object'&&!Array.isArray(value);
const number=value=>typeof value==='number'&&Number.isFinite(value);
const text=value=>typeof value==='string'?value:JSON.stringify(value);
const equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const sourceKey=value=>value?.source_collection_id&&value?.source_id?JSON.stringify([value.source_collection_id,value.source_id]):'';
const relationNotes={
 source_area:'The published polygon itself defines the contribution area. This is an original geographic source boundary; it does not establish upstream drainage.',
 geometric_context:'An explicitly stated distance around the original feature defines geographic context. Describe the distance and why it is useful.',
 upstream_huc:'The original HUC / ToHUC network supplies the upstream contributing land. Choose its actual ID/downstream fields in the source-plan form and retain the relationship evidence.'
};
function sourceSelection(row,layer,where){
 return {layer_id:row.id,...(layer?{layer}:{}),where:copy(where||{})};
}
function scalar(value){return value===null||['string','boolean'].includes(typeof value)||(number(value)&&(!Number.isInteger(value)||Number.isSafeInteger(value)));}
function parseWhere(value){
 if(!object(value)||Object.values(value).some(x=>!scalar(x)))throw Error('The geographic browser uses exact scalar field values. Keep other advanced source filters in the retained-selection editor.');
 return copy(value);
}
function boundsView(native){
 const b=native?.bounds;if(!Array.isArray(b)||b.length!==4||!b.every(number))throw Error('This original layer has no geographic bounds for the current filter.');
 let [x0,y0,x1,y1]=b;const pad=Math.max(x1-x0,y1-y0,Math.max(...b.map(Math.abs),1)*1e-8)*0.02;
 if(x1<=x0){x0-=pad;x1+=pad;}if(y1<=y0){y0-=pad;y1+=pad;}
 return {crs:native.crs,bounds:[x0,y0,x1,y1]};
}
function fieldsOptions(fields,value,empty='Choose an original field'){
 const names=Object.keys(fields||{});if(value&&!names.includes(value))names.unshift(value);
 return '<option value="">'+esc(empty)+'</option>'+names.map(name=>'<option value="'+esc(name)+'"'+(name===value?' selected':'')+'>'+esc(name)+(fields[name]?' · '+esc(fields[name]):' · retained field')+'</option>').join('');
}
function selectedLabel(feature){
 const props=feature.properties_text||feature.properties||{},candidate=['name','NAME','Name','title','TITLE','INTAKE','SYSTEM_NAME','GNIS_NAME','huc12','HUC12'];
 const key=candidate.find(key=>props[key]!==undefined&&props[key]!==null&&String(props[key]).trim());
 return key?String(props[key]):'Native feature '+feature.id;
}
function svgGeometry(geometry,view){
 const [x0,y0,x1,y1]=view.bounds,width=900,height=420,margin=12;
 const scale=Math.min((width-margin*2)/(x1-x0),(height-margin*2)/(y1-y0));
 const ox=(width-(x1-x0)*scale)/2,oy=(height-(y1-y0)*scale)/2;
 const xy=point=>Array.isArray(point)&&number(point[0])&&number(point[1])?
  [(ox+(point[0]-x0)*scale).toFixed(2),(height-oy-(point[1]-y0)*scale).toFixed(2)]:null;
 const line=(points,close=false)=>{const positions=(points||[]).map(xy).filter(Boolean);return positions.length?'M'+positions.map(p=>p.join(',')).join('L')+(close?'Z':''):'';};
 const shape=g=>{
  if(!g)return '';
  if(g.type==='Polygon')return '<path fill-rule="evenodd" d="'+esc((g.coordinates||[]).map(r=>line(r,true)).join(''))+'"/>';
  if(g.type==='MultiPolygon')return (g.coordinates||[]).map(c=>shape({type:'Polygon',coordinates:c})).join('');
  if(g.type==='LineString')return '<path class="rws-line" d="'+esc(line(g.coordinates))+'"/>';
  if(g.type==='MultiLineString')return (g.coordinates||[]).map(c=>shape({type:'LineString',coordinates:c})).join('');
  if(g.type==='Point'){const p=xy(g.coordinates);return p?'<circle cx="'+p[0]+'" cy="'+p[1]+'" r="4"/>':'';}
  if(g.type==='MultiPoint')return (g.coordinates||[]).map(c=>shape({type:'Point',coordinates:c})).join('');
  if(g.type==='GeometryCollection')return (g.geometries||[]).map(shape).join('');
  return '';
 };
 return shape(geometry);
}
export function attachReceivingSourcePicker({api,endpoint,getState,toast}){
 let active=null,sequence=0;
 function detach(){
  sequence++;if(active){active.alive=false;active.abort?.abort();active.container.replaceChildren();active=null;}
 }
 async function open({container,mode='receptor',selection={},onApply,isCurrent=()=>true}){
  if(!container||typeof onApply!=='function')throw Error('Open this source chooser from the current Receiving form.');
  if(!['receptor','catchments','catalog'].includes(mode))throw Error('Choose an original Receiving source scope.');
  detach();const workspace=getState()?.workspace_key,token=sequence;
  const s={container,workspace,token,mode,onApply,isCurrent,alive:true,serial:0,edits:0,busy:false,rows:[],layers:[],
   source:copy(selection),where:parseWhere(selection.where||{}),chosen:new Map(),cache:new Map(),
   selectionMode:Array.isArray(selection.feature_ids)?'ids':'all',layer:selection.layer||'',offsets:[0],page:0,
   method:selection.method||'source_area',rationale:selection.rationale||'',buffer:selection.buffer_m??'',
   idField:selection.id_field||'',downstreamField:selection.downstream_field||'',details:null};
  for(const id of selection.feature_ids||[])s.chosen.set(String(id),{id:copy(id),feature:null});
  active=s;
  const current=()=>active===s&&s.alive&&sequence===token&&getState()?.workspace_key===workspace&&container.isConnected&&isCurrent();
  const requireCurrent=()=>{if(!current())throw Error('The original Receiving form or workspace changed. Reopen its source chooser.');};
  const role=mode==='catchments'?'Original catchment network':'Original receiving-water features';
  container.innerHTML='<section class="water-source-picker" data-water-source-picker data-water-source-mode="'+esc(mode)+'" aria-label="'+esc(role)+'">'+
   '<header><div><h3>'+esc(role)+'</h3><p>Read retained original features, then apply their source identity to this form.</p></div><button type="button" data-rws-action="close" aria-label="Close source chooser">Close chooser</button></header>'+
   '<p class="rws-error" data-water-source-error role="alert" hidden></p><p data-water-source-loading role="status">Opening original spatial sources…</p>'+
   '<div data-rws-body></div></section>';
  s.root=container.firstElementChild;
  const error=err=>{if(!current())return;const node=s.root.querySelector('[data-water-source-error]');node.hidden=false;node.textContent=err.message||String(err);};
  const loading=(message,busy)=>{if(!current())return;s.busy=busy;s.root.setAttribute('aria-busy',busy?'true':'false');
   const node=s.root.querySelector('[data-water-source-loading]');node.textContent=message;node.hidden=!message;
   s.root.querySelectorAll('[data-rws-busy]').forEach(node=>{node.disabled=busy;});
  };
  async function read(path,payload){
   requireCurrent();const result=await api(endpoint(path),{method:'POST',body:JSON.stringify({workspace,...payload})});requireCurrent();
   if(result.workspace_key&&result.workspace_key!==workspace)throw Error('The spatial response belongs to another workspace.');
   return result;
  }
  function checkSource(result){
   if(result.selection?.layer_id!==s.row.id||result.source_sha256!==s.row.sha256)throw Error('The original spatial source identity changed. Reopen this source.');
   if(result.selection?.layer!==s.layer||!equal(result.selection?.where||{},s.where))throw Error('The original source layer or exact filter changed during inspection.');
  }
  function render(){
   requireCurrent();const previous=s.root.querySelector('[data-rws-body]'),available=s.layers;
   previous.innerHTML='<div class="rws-source-controls"><label><span>Retained source</span><select data-rws-source>'+
    '<option value="">Choose an original vector source</option>'+available.map(row=>'<option value="'+esc(row.id)+'"'+(row.id===s.row?.id?' selected':'')+'>'+esc(row.title)+' · '+esc(row.source_collection_title||row.source_collection_id.slice(0,12))+'</option>').join('')+'</select></label>'+
    '<label><span>Original layer</span><select data-rws-layer>'+(s.description?.native.layers||[]).map(name=>'<option value="'+esc(name)+'"'+(name===s.layer?' selected':'')+'>'+esc(name)+'</option>').join('')+'</select></label>'+
    '<button type="button" data-rws-action="load" data-rws-busy>Read this source / layer</button>'+(mode!=='catchments'&&Object.keys(s.where).length?'<button type="button" data-rws-action="filter-clear" data-rws-busy>Explicitly clear attribute filters</button>':'')+'</div>'+
    (s.row?'<p class="rws-provenance">'+esc(s.row.source_uri||'Retained original source')+' · '+esc(s.row.vintage||'Original edition')+'<br>Original body SHA256 <code>'+esc(s.row.sha256)+'</code></p>':'')+
    '<div data-rws-inspection></div>';
   if(!s.description)return;
   const native=s.description.native;
   s.root.querySelector('[data-rws-inspection]').innerHTML='<p>'+esc(native.geometry_type)+' · '+Number(native.feature_count).toLocaleString()+' original features'+
    (native.filtered_count===null?'':' · '+Number(native.filtered_count).toLocaleString()+' matching exact filters')+' · '+esc(native.crs)+'</p>'+
    '<details class="rws-filters"><summary>Exact original attribute filters ('+Object.keys(s.where).length+')</summary>'+
    '<p>Each field uses exact original JSON scalar equality. Strings, numbers, booleans and null keep their original types. Applying a filter never removes already-selected native IDs.</p>'+
    '<div data-rws-filters>'+(mode==='catchments'?'<pre>'+esc(JSON.stringify(s.where,null,2))+'</pre>':Object.entries(s.where).map(([name,v])=>filterRow(name,v)).join(''))+'</div>'+
    (mode==='catchments'?'<p>Network filters remain unchanged here. Revise its complete advanced selection to change the retained graph scope.</p>':'<button type="button" data-rws-action="filter-add">Add field filter</button> <button type="button" data-rws-action="filter-apply" data-rws-busy>Read matching records</button>')+'</details>'+
    (mode==='catchments'?'<div class="rws-network"><p>The existing network scope remains retained. Choose the real routing fields; upstream preparation needs the complete connected HUC / ToHUC graph, including downstream context nodes.</p>'+
      '<label>Catchment ID field<select data-rws-id-field>'+fieldsOptions(native.fields,s.idField)+'</select></label>'+
      '<label>Downstream field<select data-rws-downstream>'+fieldsOptions(native.fields,s.downstreamField)+'</select></label></div>':
      '<fieldset class="rws-selection-mode"><legend>Original feature scope</legend>'+
      '<label><input type="radio" name="rws-mode-'+token+'" value="all" data-rws-mode'+(s.selectionMode==='all'?' checked':'')+'> All matching original native IDs</label>'+
      '<label><input type="radio" name="rws-mode-'+token+'" value="ids" data-rws-mode'+(s.selectionMode==='ids'?' checked':'')+'> Only selected native feature IDs</label>'+
      '<p>These features form one receiving-area selection. Define separate areas when the waters need separate identities.</p></fieldset>'+
      '<div data-rws-selected></div>')+
    '<div class="rws-page-actions"><button type="button" data-rws-action="previous" data-rws-busy'+(s.page===0?' disabled':'')+'>Previous records</button>'+
    '<button type="button" data-rws-action="next" data-water-source-next data-rws-busy'+(s.next===null||s.next===undefined?' disabled':'')+'>Next records</button>'+
    '<span data-rws-page-status></span></div>'+
    '<div class="rws-map" data-water-source-map tabindex="0" aria-label="Original source feature display"></div>'+
    '<p class="rws-map-note">Map shows this record page in the original coordinate reference system. Geographic overlays may be clipped to this view; preparation always rereads full original source geometry. Select a feature in the table or map.</p>'+
    '<div class="rws-records" data-water-source-rows></div><div data-rws-detail></div>'+
    (mode==='receptor'?'<fieldset class="rws-relation"><legend>Contribution relationship</legend>'+
     '<label>Method<select data-rws-method>'+Object.entries({source_area:'Published source-area polygon',geometric_context:'Explicit geometric context',upstream_huc:'Original HUC / ToHUC upstream land'}).map(([id,label])=>'<option value="'+id+'"'+(id===s.method?' selected':'')+'>'+label+'</option>').join('')+'</select></label>'+
     '<p data-rws-relation-note>'+esc(relationNotes[s.method]||'Keep the original advanced method until reviewed.')+'</p>'+
     '<label>Relationship rationale<textarea data-rws-rationale rows="3">'+esc(s.rationale)+'</textarea></label>'+
     '<label>Context buffer (metres)<input data-rws-buffer type="number" min="0" step="any" value="'+esc(s.buffer)+'"></label>'+
     '<p>Published source-area relationships require polygon geometry and zero buffer. Upstream relationships require the original network and evidence in the retained selection.</p></fieldset>':'')+
    '<p class="rws-note">The form keeps its other original metadata, intake references, class designations and advanced source settings. Review those bindings if you choose another source edition.</p>'+
    '<div class="rws-apply"><button type="button" class="primary" data-rws-action="apply" data-water-source-apply data-rws-busy>Apply original selection to form</button><button type="button" data-rws-action="close">Keep form unchanged</button></div>';
   renderPage();
  }
  function filterRow(name='',value=''){
   return '<div class="rws-filter-row"><select data-rws-filter-field>'+fieldsOptions(s.description?.native.fields||{},name)+'</select>'+
    '<input data-rws-filter-value value="'+esc(JSON.stringify(value))+'" aria-label="Exact original JSON value">'+
    '<button type="button" data-rws-action="filter-remove" aria-label="Remove this exact field filter">Remove</button></div>';
  }
  function captureControls(){
   if(mode==='receptor'){
    s.method=s.root.querySelector('[data-rws-method]')?.value||s.method;
    s.rationale=s.root.querySelector('[data-rws-rationale]')?.value??s.rationale;
    s.buffer=s.root.querySelector('[data-rws-buffer]')?.value??s.buffer;
   }
   if(mode==='catchments'){
    s.idField=s.root.querySelector('[data-rws-id-field]')?.value??s.idField;
    s.downstreamField=s.root.querySelector('[data-rws-downstream]')?.value??s.downstreamField;
   }
  }
  function renderPage(){
   requireCurrent();if(!s.description)return;
   const selected=s.root.querySelector('[data-rws-selected]');
   if(selected)selected.innerHTML='<p>'+(s.selectionMode==='all'?'Apply reads every matching page and retains every matching original native ID, including records outside this visible page.':
    s.chosen.size+' selected native IDs retained across all pages.')+'</p>'+
    (s.chosen.size?'<div class="rws-selected-ids">'+[...s.chosen.entries()].map(([key,item])=>'<button type="button" data-rws-remove-id="'+esc(key)+'" title="Remove selected native feature">'+esc(item.feature?selectedLabel(item.feature):key)+' · '+esc(key)+' ×</button>').join('')+'</div><button type="button" data-rws-action="clear">Clear selected IDs</button>':'');
   const columns=Object.keys(s.description.native.fields||{}).slice(0,4);
   const rows=s.rows;
   s.root.querySelector('[data-rws-page-status]').textContent='Record page '+(s.page+1)+' · '+rows.length+' shown'+(s.next!==null&&s.next!==undefined?' · more original records available':' · end of matching records');
   s.root.querySelector('[data-rws-action="previous"]').disabled=s.busy||s.page===0;
   s.root.querySelector('[data-rws-action="next"]').disabled=s.busy||s.next===null||s.next===undefined;
   s.root.querySelector('[data-water-source-rows]').innerHTML='<table><thead><tr>'+(mode==='catchments'?'':'<th scope="col">Use</th>')+
    '<th scope="col">Native ID</th>'+columns.map(k=>'<th scope="col">'+esc(k)+'</th>').join('')+'<th scope="col">Original record</th></tr></thead><tbody>'+
    rows.map(row=>'<tr data-water-source-row="'+esc(row.id)+'">'+(mode==='catchments'?'':'<td><input type="checkbox" data-rws-id="'+esc(row.id)+'" aria-label="Select native feature '+esc(row.id)+'"'+
     (s.selectionMode==='all'||s.chosen.has(String(row.id))?' checked':'')+(s.selectionMode==='all'?' disabled':'')+'></td>')+
     '<td><code>'+esc(row.id)+'</code></td>'+columns.map(k=>'<td>'+esc(row.properties_text?.[k]??text(row.properties?.[k])??'')+'</td>').join('')+
     '<td><button type="button" data-rws-detail-id="'+esc(row.id)+'">Inspect attributes</button></td></tr>').join('')+'</tbody></table>'+
     (!rows.length?'<p>No feature matches this page and exact filter. Continue if another page is available, or review the filter.</p>':'');
   s.root.querySelector('[data-water-source-map]').innerHTML='<svg viewBox="0 0 900 420" role="img" aria-label="Original feature page in '+esc(s.view?.crs||s.description.native.crs)+'">'+
    '<rect class="rws-map-background" x="0" y="0" width="900" height="420"/>'+
    rows.map(row=>'<g data-rws-map-id="'+esc(row.id)+'" class="rws-feature'+(s.selectionMode==='all'||s.chosen.has(String(row.id))?' rws-chosen':'')+'" tabindex="0" role="button" aria-label="'+esc(selectedLabel(row))+' · native ID '+esc(row.id)+'" aria-pressed="'+(s.selectionMode==='all'||s.chosen.has(String(row.id)))+'"><title>'+esc(selectedLabel(row))+' · '+esc(row.id)+'</title>'+svgGeometry(row.geometry,s.view)+'</g>').join('')+'</svg>';
   if(s.details)renderDetail(s.details);
  }
  function renderDetail(row){
   s.details=row;
   s.root.querySelector('[data-rws-detail]').innerHTML='<details open class="rws-feature-detail"><summary>'+esc(selectedLabel(row))+' · native ID '+esc(row.id)+'</summary>'+
    '<dl>'+Object.entries(row.properties||{}).map(([key,v])=>'<dt>'+esc(key)+'</dt><dd><code>'+esc(row.properties_text?.[key]??JSON.stringify(v))+'</code></dd>').join('')+'</dl>'+
    (row.geometry_operations?.length?'<p>Original geometry interpretation</p><pre>'+esc(JSON.stringify(row.geometry_operations,null,2))+'</pre>':'')+
    '<p>Native geometry CRS: '+esc(row.native_crs||row.geometry_crs)+'. Original attributes remain in the retained source.</p></details>';
  }
  function choose(row){
   if(mode==='catchments'){renderDetail(row);return;}
   s.edits++;s.selectionMode='ids';
   const key=String(row.id);
   if(s.chosen.has(key))s.chosen.delete(key);else s.chosen.set(key,{id:row.id,feature:copy(row)});
   s.root.querySelectorAll('[data-rws-mode]').forEach(node=>{node.checked=node.value==='ids';});renderPage();
  }
  async function page(offset,serial=s.serial){
   const result=await read('/api/spatial/overlay',{selection:sourceSelection(s.row,s.layer,s.where),view:s.view,offset,limit:100,tolerance:0});
   if(serial!==s.serial)return null;checkSource(result);
   if(!Array.isArray(result.features)||!Number.isInteger(result.offset)||result.offset!==offset)throw Error('The original feature page is incomplete.');
   if(result.next_offset!==null&&result.next_offset!==undefined&&(!Number.isInteger(result.next_offset)||result.next_offset<=offset))throw Error('The original feature continuation did not advance.');
   for(const row of result.features){if(typeof row.id!=='string'||!object(row.properties))throw Error('The original feature identity or attributes are missing.');
    if(s.chosen.has(row.id))s.chosen.get(row.id).feature=copy(row);}
   s.cache.set(offset,copy(result));return result;
  }
  async function load(sourceId,layer,where){
   const serial=++s.serial;loading('Reading the retained original layer…',true);s.root.querySelector('[data-water-source-error]').hidden=true;
   try{
    const row=s.layers.find(row=>row.id===sourceId);if(!row)throw Error('Choose an original retained vector source.');
    s.row=row;s.layer=layer||row.native_layer||'';s.where=parseWhere(where);s.description=null;s.view=null;s.rows=[];s.cache.clear();s.offsets=[0];s.page=0;s.next=null;s.details=null;
    const result=await read('/api/spatial/describe',{selection:sourceSelection(row,s.layer,s.where)});
    if(serial!==s.serial)return;
    if(result.layer?.id!==row.id||result.layer?.sha256!==row.sha256||result.native?.kind!=='vector')throw Error('The retained source description has a different identity.');
    s.description=result;s.layer=result.native.selected_layer;
    if(!result.native.bounds){render();throw Error('No original geometry matches these exact filters. Review the field values or deliberately clear the filters.');}
    s.view=boundsView(result.native);
    render();const first=await page(0,serial);if(first){s.rows=first.features;s.next=first.next_offset;renderPage();}
   }catch(err){if(serial===s.serial)error(err);}
   finally{if(serial===s.serial&&current()){loading('',false);if(s.description)renderPage();}}
  }
  async function apply(){
   captureControls();requireCurrent();if(s.busy)throw Error('Wait for the original source page to finish.');
   if(!s.description||!s.row||!s.view)throw Error('Read a matching original source and layer before applying it.');
   const requested=s.root.querySelector('[data-rws-source]').value,layer=s.root.querySelector('[data-rws-layer]').value;
   if(requested!==s.row.id||layer!==s.layer)throw Error('Read the selected source / layer before applying it.');
   const pending=readFilters();if(!equal(pending,s.where))throw Error('Read the edited exact filters before applying this selection.');
   const serial=++s.serial,edits=s.edits;loading('Verifying the selected native IDs in the original source…',true);
   try{
    const result={source_collection_id:s.row.source_collection_id,source_id:s.row.source_id,layer:s.layer,where:copy(s.where)};
    if(mode!=='catchments'){
     const all=s.selectionMode==='all';
     if(!all&&!s.chosen.size)throw Error('Select at least one native feature, or deliberately choose all matching original IDs.');
     const missing=new Set(s.chosen.keys()),found=new Map();let offset=0;
     while(true){
      const response=s.cache.get(offset)||await page(offset,serial);if(!response||serial!==s.serial)return;
      checkSource(response);for(const feature of response.features){missing.delete(feature.id);found.set(feature.id,feature);}
      if(!all&&!missing.size)break;
      if(response.next_offset===null||response.next_offset===undefined){
       if(!all&&missing.size)throw Error('Selected native IDs are absent from this source / filter: '+[...missing].slice(0,20).join(', ')+'. Review the retained selection; nothing was removed.');
       break;
      }
      offset=response.next_offset;loading(all?'Reading all matching original IDs; '+found.size+' located…':'Verifying '+s.chosen.size+' native IDs; '+missing.size+' still to locate…',true);
     }
     if(!found.size)throw Error('No original feature matches this selection.');
     result.feature_ids=all?[...found.keys()].map(id=>s.chosen.has(id)?copy(s.chosen.get(id).id):id):[...s.chosen.values()].map(row=>copy(row.id));
    }
    if(mode==='catchments'){
     for(const [label,key] of [['Catchment ID',s.idField],['Downstream',s.downstreamField]])if(!key||!Object.hasOwn(s.description.native.fields,key))throw Error(label+' must be one of this layer’s actual original fields.');
     result.id_field=s.idField;result.downstream_field=s.downstreamField;
    }
    if(mode==='receptor'){
     if(!Object.hasOwn(relationNotes,s.method))throw Error('Choose the original contribution relationship.');
     if(!s.rationale.trim())throw Error('Describe the relationship between these original features and their contributing land.');
     if(s.method==='source_area'&&!/polygon/i.test(s.description.native.geometry_type))throw Error('A published source-area relationship needs original polygon geometry. Choose an explicit geometric context or evidenced HUC relationship for points/lines.');
     const buffer=s.buffer===''?undefined:Number(s.buffer);
     if(buffer!==undefined&&(!Number.isFinite(buffer)||buffer<0))throw Error('Use a finite nonnegative context buffer.');
     if(s.method==='source_area'&&buffer!==undefined&&buffer!==0)throw Error('A source-area polygon requires zero buffer. Explicitly clear the previous context distance.');
     result.method=s.method;result.rationale=s.rationale;result.buffer_m=buffer;
    }
    requireCurrent();if(serial!==s.serial)return;
    if(edits!==s.edits)throw Error('The source choices changed during verification. Review the current choices and apply again.');
    await onApply(result,{source_sha256:s.row.sha256,source_bytes:s.row.bytes,native:s.description.native});
    if(active===s)detach();
   }catch(err){error(err);}finally{if(current()){loading('',false);renderPage();}}
  }
  function readFilters(){
   if(mode==='catchments')return copy(s.where);
   const filters=Object.create(null);
   for(const row of s.root.querySelectorAll('.rws-filter-row')){
    const key=row.querySelector('[data-rws-filter-field]').value,value=row.querySelector('[data-rws-filter-value]').value;
    if(!key)throw Error('Choose an original field for each filter.');
    if(Object.hasOwn(filters,key))throw Error('Choose each original filter field once.');
    if(!Object.hasOwn(s.description.native.fields,key))throw Error('The exact filter field is absent from this original layer.');
    let parsed;try{parsed=JSON.parse(value);}catch{throw Error('Filter '+key+' needs an exact JSON scalar: quoted string, number, true, false or null.');}
    if(!scalar(parsed))throw Error('Filter '+key+' must use one exact original scalar value.');filters[key]=parsed;
   }
   return filters;
  }
  s.root.addEventListener('input',()=>{if(current())s.edits++;});
  s.root.addEventListener('change',event=>{
   if(!current())return;
   s.edits++;const node=event.target;
   if(node.matches('[data-rws-mode]')){s.selectionMode=node.value;renderPage();}
   else if(node.matches('[data-rws-id]')){const row=s.rows.find(row=>row.id===node.dataset.rwsId);if(row)choose(row);}
   else if(node.matches('[data-rws-method]')){s.method=node.value;s.root.querySelector('[data-rws-relation-note]').textContent=relationNotes[s.method]||'';}
   else if(node.matches('[data-rws-source],[data-rws-layer]')){s.serial++;loading('Read the selected original source / layer before applying it.',false);if(node.matches('[data-rws-source]'))s.root.querySelector('[data-rws-layer]').innerHTML='<option value="">Read source to discover its original layers</option>';}
  });
  s.root.addEventListener('keydown',event=>{const node=event.target.closest('[data-rws-map-id]');if(node&&['Enter',' '].includes(event.key)){event.preventDefault();const row=s.rows.find(row=>row.id===node.dataset.rwsMapId);if(row&&current())choose(row);}});
  s.root.addEventListener('click',async event=>{
   const target=event.target.closest('button,[data-rws-map-id]');if(!target||!current())return;event.preventDefault();
   try{
    if(target.dataset.rwsRemoveId!==undefined){s.edits++;s.selectionMode='ids';s.chosen.delete(target.dataset.rwsRemoveId);s.root.querySelectorAll('[data-rws-mode]').forEach(n=>n.checked=n.value==='ids');renderPage();return;}
    if(target.dataset.rwsDetailId!==undefined){const row=s.rows.find(row=>row.id===target.dataset.rwsDetailId);if(row)renderDetail(row);return;}
    if(target.dataset.rwsMapId!==undefined){const row=s.rows.find(row=>row.id===target.dataset.rwsMapId);if(row)choose(row);return;}
    const action=target.dataset.rwsAction;
    if(action==='close'){detach();return;}
    if(action==='filter-add'){s.edits++;s.root.querySelector('[data-rws-filters]').insertAdjacentHTML('beforeend',filterRow());return;}
    if(action==='filter-remove'){s.edits++;target.closest('.rws-filter-row').remove();return;}
    if(action==='clear'){s.edits++;s.selectionMode='ids';s.chosen.clear();s.root.querySelectorAll('[data-rws-mode]').forEach(n=>n.checked=n.value==='ids');renderPage();return;}
    if(action==='load'){captureControls();await load(s.root.querySelector('[data-rws-source]').value,s.root.querySelector('[data-rws-layer]').value,s.where);return;}
    if(action==='filter-apply'){captureControls();await load(s.row.id,s.layer,readFilters());return;}
    if(action==='filter-clear'){s.edits++;captureControls();await load(s.root.querySelector('[data-rws-source]').value,s.root.querySelector('[data-rws-layer]').value,{});return;}
    if(action==='apply'){await apply();return;}
    if(action==='previous'||action==='next'){
     if(s.busy)return;captureControls();
     if(action==='previous'){if(s.page===0)return;s.page--;}
     else{if(s.next===null||s.next===undefined)return;s.offsets[s.page+1]=s.next;s.page++;}
     const serial=++s.serial;loading('Reading the next original record page…',true);
     try{const result=s.cache.get(s.offsets[s.page])||await page(s.offsets[s.page],serial);if(result&&serial===s.serial){checkSource(result);s.rows=result.features;s.next=result.next_offset;renderPage();}}
     finally{if(current()&&serial===s.serial){loading('',false);renderPage();}}
    }
   }catch(err){error(err);}
  });
  try{
   const result=await api(endpoint('/api/spatial/catalog'));requireCurrent();
   if(result.workspace_key&&result.workspace_key!==workspace)throw Error('The spatial catalogue belongs to another workspace.');
   s.layers=(result.layers||[]).filter(row=>row.group==='source'&&row.kind==='vector'&&row.source_collection_id&&row.source_id);
   if(!s.layers.length)throw Error('Import the original vector source before choosing its native features.');
   const row=s.layers.find(row=>sourceKey(row)===sourceKey(selection));s.row=row||null;
   render();if(row)await load(row.id,s.layer,s.where);else loading('Choose an original vector source and read its layers.',false);
  }catch(err){loading('',false);error(err);}
  return {close:()=>{if(active===s)detach();}};
 }
 return {open,detach};
}
