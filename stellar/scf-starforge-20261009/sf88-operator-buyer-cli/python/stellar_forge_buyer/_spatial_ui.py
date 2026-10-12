"""GIS operator assets for the existing neutral DuckDB application."""

HTML = r"""
<section id="screen-spatial" class="screen" hidden>
<div class="page-title"><div><h2>GIS workspace</h2><p>Review source geometry, retain layers, and exchange complete spatial query results.</p></div><button id="gis-runtime">Check spatial runtime</button></div>
<section class="panel"><form id="gis-review-form"><h3>Review an original dataset layer</h3>
<div class="form-grid"><label>Dataset edition<select id="gis-edition" required></select></label><label>Geometry source column<select id="gis-source-column" required></select></label>
<label>Source format<select id="gis-format"><option value="esri-json">ArcGIS geometry JSON</option><option value="geojson">GeoJSON geometry</option><option value="wkt">WKT</option><option value="wkb-hex">WKB hexadecimal</option></select></label>
<label>Original CRS<input id="gis-crs" required placeholder="EPSG:3857" spellcheck="false"></label>
<label>Original spatial reference column<select id="gis-reference-column"></select></label>
<label>ArcGIS geometry type<select id="gis-geometry-type"><option value="esriGeometryPolygon">Polygon</option><option value="esriGeometryPolyline">Polyline</option><option value="esriGeometryPoint">Point</option><option value="esriGeometryMultipoint">Multipoint</option></select></label>
<label>Record key columns<input id="gis-keys" placeholder="object_id" spellcheck="false"></label>
<label>Native geometry column<input id="gis-geometry-name" value="geometry" required spellcheck="false"></label></div>
<p class="hint">Use the source CRS and original linear XY geometry. Review retains the source coordinates, keys, nulls, empty shapes and validity results. Curved or higher-dimensional sources require their own explicit source conversion.</p>
<button class="primary" type="submit">Review geometry and CRS</button></form>
<div id="gis-review-result" hidden><dl id="gis-review-facts" class="facts"></dl><button id="gis-adopt" class="primary">Retain reviewed layer</button><details><summary>Complete source review</summary><pre id="gis-review-record"></pre></details></div></section>
<div class="two-column"><section class="panel"><h3>Retained layers</h3><div id="gis-layers" class="item-list"></div><h3>Saved spatial queries</h3><div id="gis-queries" class="item-list compact"></div><h3>Saved layer reviews</h3><div id="gis-reviews" class="item-list compact"></div></section>
<section class="panel" id="gis-layer-detail" hidden><h3 id="gis-layer-title">Layer</h3><dl id="gis-layer-facts" class="facts"></dl><div id="gis-map" class="gis-map"></div><p id="gis-map-caption" class="hint"></p>
<form id="gis-activate-form"><label>Current layer name<input id="gis-view-name" value="current_map" required spellcheck="false"></label><div class="toolbar"><button type="submit">Activate layer</button><button id="gis-use-layer" type="button">Use layer in SQL</button></div></form></section></div>
<section class="panel"><form id="gis-query-form"><h3>Spatial SQL</h3><label for="gis-sql">Read-only query</label><textarea id="gis-sql" rows="8" spellcheck="false" placeholder="SELECT * FROM current_map"></textarea>
<div class="form-grid"><label>Parameters (JSON array)<input id="gis-parameters" value="[]" spellcheck="false"></label><label>Preview rows<input id="gis-limit" type="number" min="1" max="10000" value="100"></label></div>
<div class="toolbar"><button type="submit" class="primary">Run spatial query</button><button id="gis-save" type="button">Save query</button><button id="gis-export" type="button">Export GeoPackage + GeoParquet</button></div>
<div class="form-grid"><label>Saved query name<input id="gis-query-name" placeholder="selected_features" spellcheck="false"></label><label>Result geometry column<input id="gis-export-geometry" value="geometry" spellcheck="false"></label>
<label>Export CRS<input id="gis-export-crs" placeholder="Keep the query CRS" spellcheck="false"></label><label>Analysis CRS for area<input id="gis-area-crs" placeholder="Choose a suitable projected CRS" spellcheck="false"></label></div>
<p id="gis-query-revision" class="hint"></p></form>
<details><summary>Selection and analysis</summary><p class="hint">Bounds use the selected layer's original X/Y coordinates. Area uses the projected CRS you choose above.</p>
<div class="form-grid"><label>Minimum X<input id="gis-xmin" type="number" step="any"></label><label>Minimum Y<input id="gis-ymin" type="number" step="any"></label><label>Maximum X<input id="gis-xmax" type="number" step="any"></label><label>Maximum Y<input id="gis-ymax" type="number" step="any"></label></div>
<div class="toolbar"><button id="gis-select-bounds">Select intersecting features</button><button id="gis-clip-bounds">Clip to bounds</button><button id="gis-area">Area by record key</button></div></details>
<div id="gis-result" hidden><h3>Spatial query result</h3><div id="gis-result-table" class="table-scroll"></div><p id="gis-result-summary" class="hint"></p><details><summary>Native types and layer bindings</summary><pre id="gis-result-record"></pre></details></div></section>
<section class="panel"><h3>Receiving exported work</h3><p>Open the saved GeoPackage's <span class="mono">features</span> layer in a GIS application, or open the GeoParquet file in a spatial data tool. Each export includes the complete source editions, the original SQL revision, CRS and field representations, and a receiving guide.</p><p class="hint">The exporter reopens both files through a fresh native reader and compares every attribute and WKB geometry. Saved exports and interrupted operations remain in the existing Saved exports page.</p></section>
</section>
"""

CSS = r"""
.gis-map{min-height:260px;border:1px solid var(--line);background:#f7f7f5;margin:16px 0}
.gis-map svg{display:block;width:100%;height:300px}
.gis-shape{fill:#d4d4d0;fill-rule:evenodd;stroke:#50504c;stroke-width:1;vector-effect:non-scaling-stroke}
.gis-line{fill:none}.gis-point{fill:#4d4d49;stroke:#fafaf8}
"""

JS = r"""
(function(){
'use strict';
const gis={review:null,layer:null,query:null,preview:null};
const quote=function(value){return "'"+String(value).replaceAll("'","''")+"'";};
function catalog(){return state.data&&state.data.spatial||{layers:[],reviews:[],queries:[],bindings:{layers:[]}};}
function renderGIS(){
  const data=catalog(),editions=state.data&&state.data.editions||[];
  fillEditionSelect('gis-edition',editions);fillSourceColumns();
  $('gis-layers').replaceChildren();
  data.layers.forEach(function(layer){item($('gis-layers'),count(layer.row_count)+' features · '+short(layer.layer_id),layer.crs+' · '+layer.geometry_types.join(', '),function(){run('Opening GIS layer',async function(){await openLayer(layer.layer_id);notice('Retained GIS layer opened.');});},gis.layer&&gis.layer.layer_id===layer.layer_id);});
  if(!data.layers.length)$('gis-layers').append(element('p','Review an existing edition to retain a layer.','hint'));
  $('gis-reviews').replaceChildren();
  data.reviews.forEach(function(review){item($('gis-reviews'),count(review.row_count)+' features · '+review.crs,short(review.review_id),function(){showReviewGIS(review);show('spatial');});});
  $('gis-queries').replaceChildren();
  data.queries.forEach(function(query){item($('gis-queries'),query.name,'Revision '+query.revision,function(){loadGISQuery(query);});});
}
window.stellarDuckDBSpatialRender=renderGIS;
window.stellarDuckDBSpatialLoadQuery=loadGISQuery;
function fillSourceColumns(){
  const edition=(state.data&&state.data.editions||[]).find(function(e){return e.edition_id===$('gis-edition').value;});
  const names=edition?(edition.columns||[]).map(function(c){return c.name;}):[];
  [['gis-source-column','geometry_json',false],['gis-reference-column','spatial_reference_json',true]].forEach(function(spec){
    const select=$(spec[0]),previous=select.value;
    select.replaceChildren();
    const empty=element('option',spec[2]?'No source CRS column':'Choose a column');empty.value='';select.append(empty);
    names.forEach(function(name){const option=element('option',name);option.value=name;select.append(option);});
    select.value=names.includes(previous)?previous:names.includes(spec[1])?spec[1]:'';
  });
  if(edition&&!$('gis-keys').value)$('gis-keys').value=(edition.keys||[]).join(', ');
}
function showReviewGIS(review){
  gis.review=review;$('gis-review-result').hidden=false;$('gis-review-facts').replaceChildren();
  fact($('gis-review-facts'),'Source CRS',review.crs);fact($('gis-review-facts'),'Features',count(review.row_count));
  fact($('gis-review-facts'),'Original coordinates',count(review.coordinate_count));
  Object.entries(review.states||{}).forEach(function(p){fact($('gis-review-facts'),p[0],count(p[1]));});
  fact($('gis-review-facts'),'Extent',review.extent);$('gis-review-record').textContent=pretty(review);
}
function drawMap(preview){
  const container=$('gis-map');container.replaceChildren();
  const extent=preview.extent;
  if(!extent){container.append(element('p','This layer has no nonempty geometry.','hint'));return;}
  const width=640,height=300,pad=16,dx=extent[2]-extent[0]||1,dy=extent[3]-extent[1]||1,scale=Math.min((width-2*pad)/dx,(height-2*pad)/dy);
  const ox=(width-dx*scale)/2,oy=(height-dy*scale)/2;
  const xy=function(p){if(!Array.isArray(p)||!Number.isFinite(p[0])||!Number.isFinite(p[1]))throw new Error('Invalid native geometry preview.');return [ox+(p[0]-extent[0])*scale,height-oy-(p[1]-extent[1])*scale];};
  const ns='http://www.w3.org/2000/svg',svg=document.createElementNS(ns,'svg');svg.setAttribute('viewBox','0 0 '+width+' '+height);svg.setAttribute('role','img');svg.setAttribute('aria-label','Original GIS features in '+preview.crs);
  function line(points,closed){return points.map(function(p,i){const v=xy(p);return (i?'L':'M')+v[0]+','+v[1];}).join(' ')+(closed?' Z':'');}
  function shape(geometry,key){
    if(!geometry)return;
    if(geometry.type==='GeometryCollection'){(geometry.geometries||[]).forEach(function(g){shape(g,key);});return;}
    const coordinates=geometry.coordinates||[];let d='',klass='gis-shape';
    if(geometry.type==='Polygon')d=coordinates.map(function(r){return line(r,true);}).join(' ');
    else if(geometry.type==='MultiPolygon')d=coordinates.flatMap(function(p){return p.map(function(r){return line(r,true);});}).join(' ');
    else if(geometry.type==='LineString'){d=line(coordinates,false);klass+=' gis-line';}
    else if(geometry.type==='MultiLineString'){d=coordinates.map(function(l){return line(l,false);}).join(' ');klass+=' gis-line';}
    else if(geometry.type==='Point'||geometry.type==='MultiPoint'){
      (geometry.type==='Point'?[coordinates]:coordinates).forEach(function(p){if(!p.length)return;const v=xy(p),dot=document.createElementNS(ns,'circle');dot.setAttribute('cx',v[0]);dot.setAttribute('cy',v[1]);dot.setAttribute('r','3');dot.setAttribute('class','gis-point');const title=document.createElementNS(ns,'title');title.textContent=text(key);dot.append(title);svg.append(dot);});return;
    }else return;
    const path=document.createElementNS(ns,'path');path.setAttribute('d',d);path.setAttribute('class',klass);const title=document.createElementNS(ns,'title');title.textContent=text(key);path.append(title);svg.append(path);
  }
  preview.features.forEach(function(feature){shape(feature.geometry,feature.key);});container.append(svg);
}
async function openLayer(id){
  const preview=await api('/api/spatial/preview',{layer_id:id,max_rows:100});gis.layer=preview.layer;
  $('gis-layer-detail').hidden=false;$('gis-layer-title').textContent='Retained GIS layer';$('gis-layer-facts').replaceChildren();
  fact($('gis-layer-facts'),'CRS',gis.layer.crs);fact($('gis-layer-facts'),'Geometry',gis.layer.geometry_name);fact($('gis-layer-facts'),'Features',count(gis.layer.row_count));fact($('gis-layer-facts'),'Keys',gis.layer.keys.join(', '));fact($('gis-layer-facts'),'SQL table',gis.layer.table);
  drawMap(preview);$('gis-map-caption').textContent='Original X/Y coordinates · '+preview.crs+' · '+count(preview.features.length)+' displayed features'+(preview.truncated?' · Preview limited to 100':'');
  if(preview.extent)['gis-xmin','gis-ymin','gis-xmax','gis-ymax'].forEach(function(id,i){$(id).value=preview.extent[i];});
  const active=catalog().bindings.layers.find(function(v){return v.layer_id===id;});if(active)$('gis-view-name').value=active.name;
  $('gis-export-geometry').value=gis.layer.geometry_name;renderGIS();show('spatial');
}
function useLayer(){if(!gis.layer)throw new Error('Open a retained GIS layer first.');$('gis-sql').value='SELECT * FROM '+sqlName(gis.layer.table);$('gis-parameters').value='[]';gis.preview=null;$('gis-sql').focus();}
function queryRequestGIS(){
  const sql=$('gis-sql').value.trim();if(!sql)throw new Error('Enter spatial SQL or select a retained layer.');
  let parameters;try{parameters=JSON.parse($('gis-parameters').value);}catch(e){throw new Error('Parameters must be a valid JSON array.');}
  if(!Array.isArray(parameters)||parameters.some(function(v){return typeof v==='number'&&(!Number.isFinite(v)||(Number.isInteger(v)&&!Number.isSafeInteger(v)));}))throw new Error('Use a JSON parameter array and quote integers beyond the exact JavaScript range.');
  const limit=Number($('gis-limit').value);if(!Number.isInteger(limit)||limit<1||limit>10000)throw new Error('Choose 1 to 10,000 preview rows.');
  return {sql:sql,parameters:parameters,max_rows:limit};
}
function loadGISQuery(query){gis.query=query;gis.preview=null;$('gis-sql').value=query.sql;$('gis-parameters').value=JSON.stringify(query.parameters||[]);$('gis-query-name').value=query.name;$('gis-query-revision').textContent='Saved revision '+query.revision;show('spatial');}
async function saveGISQuery(){
  const request=queryRequestGIS();let name=$('gis-query-name').value.trim();if(!name)throw new Error('Name this spatial query before saving or exporting.');
  const existing=catalog().queries.find(function(q){return q.name.toLowerCase()===name.toLowerCase();});
  if(existing&&existing.sql===request.sql&&JSON.stringify(existing.parameters)===JSON.stringify(request.parameters))return existing;
  const result=await api('/api/spatial/queries',{name:name,sql:request.sql,parameters:request.parameters,expected_revision:existing?existing.revision:0});
  gis.query=result;$('gis-query-revision').textContent='Saved revision '+result.revision;await refresh();return result;
}
function selection(clip){
  if(!gis.layer)throw new Error('Open a retained GIS layer first.');
  const ids=['gis-xmin','gis-ymin','gis-xmax','gis-ymax'];if(ids.some(function(id){return $(id).value==='';}))throw new Error('Enter all four bounds in the source CRS.');
  const bounds=ids.map(function(id){return Number($(id).value);});if(bounds.some(function(v){return !Number.isFinite(v);})||bounds[0]>bounds[2]||bounds[1]>bounds[3])throw new Error('Review the minimum and maximum coordinates.');
  const g=sqlName(gis.layer.geometry_name),box='ST_SetCRS(ST_MakeEnvelope(?,?,?,?),'+quote(gis.layer.crs)+')';
  $('gis-sql').value=clip?'WITH bounds AS (SELECT '+box+' AS box)\nSELECT source.* EXCLUDE ('+g+'), ST_SetCRS(ST_Intersection(source.'+g+',bounds.box),'+quote(gis.layer.crs)+') AS '+g+'\nFROM '+sqlName(gis.layer.table)+' source,bounds\nWHERE ST_Intersects(source.'+g+',bounds.box)':'SELECT * FROM '+sqlName(gis.layer.table)+'\nWHERE ST_Intersects('+g+','+box+')';
  $('gis-parameters').value=JSON.stringify(bounds);gis.preview=null;
}
$('gis-edition').addEventListener('change',function(){$('gis-keys').value='';fillSourceColumns();});
$('gis-sql').addEventListener('input',function(){gis.preview=null;});$('gis-parameters').addEventListener('input',function(){gis.preview=null;});
bind('gis-runtime','Checking installed spatial runtime',async function(){const result=await api('/api/spatial/runtime',{});notice('DuckDB '+result.duckdb+' spatial runtime is available with native GIS drivers.');});
submit('gis-review-form','Reviewing original geometry and CRS',async function(){
  const body={edition_id:$('gis-edition').value,geometry_column:$('gis-source-column').value,source_format:$('gis-format').value,crs:$('gis-crs').value.trim(),geometry_name:$('gis-geometry-name').value.trim()};
  if($('gis-reference-column').value)body.spatial_reference_column=$('gis-reference-column').value;
  if(body.source_format==='esri-json')body.geometry_type=$('gis-geometry-type').value;
  const keys=keyList($('gis-keys').value);if(keys.length)body.keys=keys;
  showReviewGIS(await api('/api/spatial/reviews',body));await refresh();notice('Original geometry and CRS review retained.');
});
bind('gis-adopt','Retaining reviewed GIS layer',async function(){if(!gis.review)throw new Error('Review a source layer first.');const layer=await api('/api/spatial/adopt',{review_id:gis.review.review_id});await refresh();await openLayer(layer.layer_id);notice('GIS layer retained with its original source.');});
submit('gis-activate-form','Selecting current GIS layer',async function(){if(!gis.layer)throw new Error('Open a layer first.');const name=$('gis-view-name').value.trim(),prior=catalog().bindings.layers.find(function(v){return v.name.toLowerCase()===name.toLowerCase();});await api('/api/spatial/activate',{name:name,layer_id:gis.layer.layer_id,expected_revision:prior?prior.revision:0});await refresh();notice('Current GIS layer selected.');});
bind('gis-use-layer','Selecting layer in SQL',async function(){useLayer();notice('Layer SQL is ready.');});
bind('gis-select-bounds','Preparing spatial selection',async function(){selection(false);notice('Extent selection is ready to run.');});
bind('gis-clip-bounds','Preparing spatial clip',async function(){selection(true);notice('Geometry intersection is ready to run.');});
bind('gis-area','Preparing area analysis',async function(){if(!gis.layer)throw new Error('Open a layer first.');const crs=$('gis-area-crs').value.trim();if(!crs)throw new Error('Choose a suitable projected analysis CRS first.');$('gis-sql').value='SELECT '+gis.layer.keys.map(sqlName).join(', ')+', ST_Area(ST_Transform('+sqlName(gis.layer.geometry_name)+','+quote(crs)+')) AS area_in_crs_units_squared\nFROM '+sqlName(gis.layer.table);$('gis-parameters').value='[]';gis.preview=null;notice('Area query is ready in the selected analysis CRS.');});
submit('gis-query-form','Running native spatial query',async function(){const request=queryRequestGIS(),result=await api('/api/spatial/query',request);gis.preview={request:request,bindings:result.bindings};table($('gis-result-table'),result.columns,result.rows);$('gis-result').hidden=false;$('gis-result-summary').textContent=count(result.rows.length)+' preview rows'+(result.truncated?' · Export for the full result':' · Complete result');$('gis-result-record').textContent=pretty({columns:result.columns,bindings:result.bindings});notice('Native spatial query completed.');});
bind('gis-save','Saving spatial query',async function(){const query=await saveGISQuery();notice('Saved '+query.name+' revision '+query.revision+'.');});
bind('gis-export','Exporting and independently reopening GIS files',async function(){const query=await saveGISQuery(),body={query_id:query.query_id,expected_revision:query.revision,geometry_column:$('gis-export-geometry').value.trim()};if($('gis-export-crs').value.trim())body.target_crs=$('gis-export-crs').value.trim();if(gis.preview)body.expected_bindings=gis.preview.bindings;const record=await retainedAction('/api/spatial/exports',body);await refresh();await selectExport(record.export_id);notice('Complete GeoPackage, GeoParquet and original source files are ready.');});

window.stellarDuckDBSpatialExportSchema=function(record){
  let panel=$('gis-export-schema');
  if(!panel){panel=element('div');panel.id='gis-export-schema';$('export-schema').append(panel);}
  panel.replaceChildren();panel.hidden=record.kind!=='gis-query';if(panel.hidden)return;
  panel.append(element('h3','GIS file interpretation'));const facts=element('dl',undefined,'facts');panel.append(facts);
  fact(facts,'Output CRS',record.crs);fact(facts,'Source CRS',record.source_crs);fact(facts,'Geometry column',record.geometry_column);fact(facts,'Axis order','X then Y');fact(facts,'Native receiving',record.receiving&&record.receiving.state);
  panel.append(element('p','The table below shows GeoPackage field representations. The table above shows GeoParquet types. Restore exact text fields to the recorded SQL type when using an analytical engine.','hint'));
  const target=element('div',undefined,'table-scroll');panel.append(target);
  const original=new Map((record.query_columns||[]).map(function(c){return [c.name,c.type];}));
  table(target,['Column','SQL type','GeoPackage type','Representation'],(record.gpkg_columns||[]).map(function(c){return [c.name,original.get(c.name)||c.type,c.type,c.encoding==='exact_text'?'Exact text':'Native'];}));
};

if(state.data)renderGIS();
})();
"""
