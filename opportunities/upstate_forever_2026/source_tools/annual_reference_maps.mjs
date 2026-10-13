// Five annual-reference basins using the maintained full-geometry map renderer.
import { createArchiveCodec } from "./archive_codec.mjs";
import { renderFlowMap } from "./observed_flow_map.mjs";
const codec=createArchiveCodec();
const json=x=>JSON.stringify(x,null,2)+"\n";
const bytes=x=>codec.utf8Encode(x);
const sha=x=>codec.sha256(bytes(x));
const esc=x=>String(x??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const canonical=x=>JSON.stringify(x,(_,v)=>v&&typeof v==="object"&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v);
const identity=(path,body)=>({path,bytes:bytes(body).length,sha256:sha(body)});
const ROOT="source/usgs-southeast-sparrow-2012/";
const DISPLAY="annual-reference-display-geometry.geojson";
const OPTIONS={actionLabel:"Select annual reference basin",pointLabel:"original NLDI reach start vertex used as label anchor",featureLabel:"retained reference footprints",mapLabel:"Original annual-reference catchment footprints",width:900,height:600,labelSize:16};
export const ANNUAL_MAP_EDITION="original-annual-basin-footprints-v1";

function project(position) {
  const [lon,lat]=position;
  if(position.length!==2||!Number.isFinite(lon)||!Number.isFinite(lat)||Math.abs(lon)>180||Math.abs(lat)>=85.051129)
    throw Error("Original basin must retain finite WGS84 longitude/latitude inside the display projection.");
  // The same PROJ spherical Web Mercator formula used by renderFlowMap.
  return [6378137*lon*Math.PI/180,6378137*Math.log(Math.tan(Math.PI/4+lat*Math.PI/360))];
}
function polygons(geometry) {
  const ps=geometry?.type==="Polygon"?[geometry.coordinates]:geometry?.type==="MultiPolygon"?geometry.coordinates:null;
  if(!ps?.length)throw Error("Annual basin source requires its original polygon components.");
  for(const polygon of ps)for(const ring of polygon){
    if(!Array.isArray(ring)||ring.length<4||JSON.stringify(ring[0])!==JSON.stringify(ring.at(-1)))
      throw Error("Original annual basin ring is incomplete.");
    for(const point of ring)project(point);
  }
  return ps;
}
function transformed(geometry) {
  if(geometry.type==="LineString")return {type:"LineString",coordinates:geometry.coordinates.map(project)};
  return {type:"MultiPolygon",coordinates:polygons(geometry).map(p=>p.map(r=>r.map(project)))};
}
function positions(g){return g.type==="LineString"?g.coordinates:g.type==="Polygon"?g.coordinates.flat():g.coordinates.flat(2);}
function extent(gs){
  let a=Infinity,b=Infinity,c=-Infinity,d=-Infinity;
  for(const g of gs)for(const p of positions(g)){a=Math.min(a,p[0]);b=Math.min(b,p[1]);c=Math.max(c,p[0]);d=Math.max(d,p[1]);}
  const span=Math.max(c-a,d-b),margin=span*.04;
  if(!(span>0))throw Error("Annual display extent is empty.");
  return[a-margin,b-margin,c+margin,d+margin];
}
function sourceObject(files,path,expected) {
  const body=files[path];
  if(typeof body!=="string"||sha(body)!==expected)throw Error("Original annual basin source bytes differ: "+path);
  return {body,value:JSON.parse(body),descriptor:identity(path,body)};
}
function featureGeometry(source) {
  if(source.type!=="FeatureCollection"||source.features?.length!==1||source.features[0].type!=="Feature")
    throw Error("Retain the one original NLDI source feature.");
  if(source.crs)throw Error("A declared source CRS needs an explicit reviewed geographic conversion.");
  return source.features[0];
}
function figureFor(items,display,descriptor,{review=false}={}) {
  const geometries={},layers=[],legend=[];
  const add=(geometry,role,id,original)=>{
    const key=sha(canonical(geometry));geometries[key]=geometry;
    layers.push({role,receptor_id:id,geometry:key,source:descriptor,original_source:original});
  };
  for(const b of [...items].sort((a,b)=>b.area_km2-a.area_km2||a.site.localeCompare(b.site))){
    add(display[b.site].selected,"contribution",b.site,b.basin_source);
    if(review){if(display[b.site].excluded)add(display[b.site].excluded,"receptor",b.site+":excluded",b.basin_source);}
    else add(display[b.site].reach,"receptor",b.site,b.reach_source);
  }
  for(const b of items)legend.push({label:b.site+" · "+b.name+" · "+b.area_km2.toFixed(2)+" km²",anchor:project(b.point)});
  if(review){
    const excluded=items.find(b=>b.excluded.length);
    if(excluded)legend.push({label:"Excluded original remote components (retained in source)",anchor:project(excluded.excluded[0][0][0])});
  }
  return {schema:"upstate.scientific-figure/v1",title:review?"Original source component review":"Five annual-reference catchments",
    geometries,panels:[{kind:"projected_geometry_map",title:review?"Selected footprints and retained excluded components":"Whole-basin support for the original eleven annual targets",
      crs:{name:"Web Mercator display · EPSG:3857",wkt:"EPSG:3857",units:"metre",axes:"XY"},
      bounds:extent(Object.values(geometries)),layers,legend,
      role_labels:{contribution:"Selected original reference components",receptor:review?"Excluded original component outlines":"Original NLDI reference reaches"}}],
    source_coordinate_system:"EPSG:4326, original longitude/latitude",
    display_projection:"EPSG:3857 spherical Web Mercator; full vertices transformed only for display",
    area_method:"Original retained EPSG:5070 whole-basin areas; display geometry is not an area denominator"};
}
export function buildAnnualReferenceMaps({annual,annualSourceText,originalFiles}) {
  if(typeof annualSourceText!=="string"||JSON.stringify(JSON.parse(annualSourceText))!==JSON.stringify(annual))
    throw Error("Retain the exact original annual summary bytes.");
  if(annual?.schema!=="upstate.annual-reference-assessment-context/v1"||annual.basins?.length!==5)
    throw Error("Use the retained five-basin annual reference edition.");
  const reviewBody=originalFiles[ROOT+"geometry-review.json"];
  if(typeof reviewBody!=="string")throw Error("Retain the original basin component review.");
  const review=JSON.parse(reviewBody), byComid=new Map((review.reviews||[]).map(r=>[r.published_comid,r]));
  const basins=[],display={},originalFeatures=[],selectedFeatures=[],displayFeatures=[],sources=[];
  for(const basin of annual.basins){
    const site=String(basin.comid),r=byComid.get(site);
    if(!r||JSON.stringify(r.selected_component_indices)!==JSON.stringify(basin.selected_component_indices)||
       r.source_basin.sha256!==basin.basin_source_sha256)
      throw Error("Annual map and original reviewed component selections differ.");
    const src=sourceObject(originalFiles,ROOT+r.source_basin.path,r.source_basin.sha256);
    const reach=sourceObject(originalFiles,ROOT+r.source_feature.path,r.source_feature.sha256);
    const original=featureGeometry(src.value),line=featureGeometry(reach.value);
    const ps=polygons(original.geometry),selected=r.selected_component_indices;
    if(ps.length!==r.original_component_count||ps.length!==basin.original_component_count||
       new Set(selected).size!==selected.length||selected.some(i=>!Number.isInteger(i)||i<0||i>=ps.length)||
       line.geometry?.type!=="LineString"||line.geometry.coordinates.length<2||
       String(line.properties?.comid??line.properties?.identifier)!==site)
      throw Error("Original basin components or NLDI reach identity differ.");
    line.geometry.coordinates.forEach(project);
    const omitted=ps.map((_,i)=>i).filter(i=>!selected.includes(i));
    if(JSON.stringify(omitted)!==JSON.stringify(r.omitted_component_indices))throw Error("Original excluded component review differs.");
    const geometry={type:"MultiPolygon",coordinates:selected.map(i=>ps[i])},excluded=omitted.map(i=>ps[i]);
    const area=basin.selected_basin_area_km2;
    if(!Number.isFinite(area)||area<=0)throw Error("Original whole-basin area is unavailable.");
    const b={site,name:basin.original_target_station_names.join(" / "),geometry,
      point:line.geometry.coordinates[0],reach:line.geometry,relation:"original reach start; not a station-position estimate",
      excluded,selected_component_indices:selected,omitted_component_indices:omitted,
      component_selection_reason:r.component_selection_reason,area_km2:area,
      basin_source:src.descriptor,reach_source:reach.descriptor};
    basins.push(b);sources.push(src.descriptor,reach.descriptor);
    display[site]={selected:transformed(geometry),reach:transformed(line.geometry),
      excluded:excluded.length?transformed({type:"MultiPolygon",coordinates:excluded}):null};
    for(let index=0;index<ps.length;index++){
      const properties={...original.properties,comid:site,component_index:index,
        selected:selected.includes(index),source_sha256:src.descriptor.sha256,
        source_path:src.descriptor.path,whole_selected_basin_area_km2:area};
      const feature={type:"Feature",id:site+":"+index,properties,geometry:{type:"Polygon",coordinates:ps[index]}};
      originalFeatures.push(feature);if(properties.selected)selectedFeatures.push(feature);
    }
    for(const [role,g]of Object.entries(display[site]))if(g)displayFeatures.push({type:"Feature",
      id:site+":"+role,properties:{comid:site,role,basin_source:src.descriptor,reach_source:reach.descriptor},geometry:g});
  }
  const displayBody=json({type:"FeatureCollection",name:"Annual reference geometry — display only",
    crs:{type:"name",properties:{name:"EPSG:3857"}},source_crs:"EPSG:4326",
    projection:{name:"Spherical Web Mercator",radius_m:6378137,formula:"x=R*lambda; y=R*ln(tan(pi/4+phi/2))",
      reference:"https://proj.org/en/stable/operations/projections/webmerc.html",vertex_simplification:false,area_recalculation:false},
    features:displayFeatures});
  const descriptor=identity("association/"+DISPLAY,displayBody);
  const figure=figureFor(basins,display,descriptor),componentFigure=figureFor(basins,display,descriptor,{review:true});
  const context={schema:"upstate.annual-reference-basin-maps/v1",edition:ANNUAL_MAP_EDITION,basins,
    input_sha256:annual.input_sha256,
    annual_source:identity("source/annual-reference-assessment-20261013/annual-reference-assessment-summary.json",annualSourceText),
    source_coordinate_system:"EPSG:4326",display_coordinate_system:"EPSG:3857",
    area_coordinate_system:"EPSG:5070",area_source:"retained annual-reference-assessment-summary.json",
    sources:[...sources,identity(ROOT+"geometry-review.json",reviewBody)],
    original_coordinate_operations:annual.coordinate_operations,relationships:annual.basin_overlaps,
    selected_vertices:basins.reduce((n,b)=>n+positions(b.geometry).length,0),
    original_vertices:originalFeatures.reduce((n,f)=>n+positions(f.geometry).length,0)};
  const files={
    "annual-reference-basin-map.json":json(context),
    "annual-reference-original-components.geojson":json({type:"FeatureCollection",features:originalFeatures}),
    "annual-reference-selected-basins.geojson":json({type:"FeatureCollection",features:selectedFeatures}),
    [DISPLAY]:displayBody,"annual-reference-basin-figure.json":json(figure),
    "annual-reference-component-figure.json":json(componentFigure),
    "annual-reference-basins.svg":renderFlowMap(context,"",false,OPTIONS),
  };
  const reviewBasins=basins.flatMap(b=>[b,...b.excluded.map((p,i)=>({site:b.site+":excluded:"+i,name:"Excluded original component of "+b.site,geometry:{type:"Polygon",coordinates:p},point:p[0][0],excluded:true}))]);
  files["annual-reference-original-components.svg"]=renderFlowMap({basins:reviewBasins},"",false,{...OPTIONS,mapLabel:"Selected and excluded original source components"});
  for(const b of basins)files["annual-reference-basin-"+b.site+".svg"]=renderFlowMap(context,b.site,true,OPTIONS);
  return {context,figure,componentFigure,files};
}

function annualMapBrowser() {
  const el=id=>document.getElementById(id),root=el("annual-basin-geography");
  if(!root)return;
  try {
    const context=JSON.parse(el("annual-basin-data").textContent), saved=JSON.parse(el("annual-basin-state").textContent||"null");
    const options={actionLabel:"Select annual reference basin",pointLabel:"original NLDI reach start vertex used as label anchor",featureLabel:"retained reference footprints",mapLabel:"Original annual-reference catchment footprints",width:900,height:600,labelSize:16};
    const select=el("annual-map-select"),focus=el("annual-map-focus"),review=el("annual-map-excluded");
    if(saved&&context.basins.some(b=>b.site===saved.selected)){select.value=saved.selected;focus.checked=!!saved.focus;review.checked=!!saved.review;}
    function draw(){
      let basins=context.basins;
      if(review.checked)basins=basins.flatMap(b=>[b,...b.excluded.map((p,i)=>({site:b.site+":excluded:"+i,
        name:"Excluded original component of "+b.site,geometry:{type:"Polygon",coordinates:p},point:p[0][0],
        relation:"original excluded component; no reference load is assigned",excluded:true}))]);
      const selected=select.value;
      el("annual-map-canvas").innerHTML=renderFlowMap({basins},selected,focus.checked&&!review.checked,options);
      const b=context.basins.find(b=>b.site===selected);
      el("annual-map-description").textContent=b?
        b.name+" · COMID "+b.site+" · whole selected basin "+b.area_km2.toLocaleString("en-US",{maximumFractionDigits:3})+
        " km² (original EPSG:5070 area). Components "+b.selected_component_indices.join(", ")+
        (b.omitted_component_indices.length?"; excluded "+b.omitted_component_indices.join(", ")+". "+b.component_selection_reason:". All original components retained."):
        "All five reference basins. The three tributaries are mutually disjoint and nested within both downstream basins; Jackson is nested inside Cohens. Whole-basin totals overlap and must not be summed as independent regional parts.";
      el("annual-basin-state").textContent=JSON.stringify({selected,focus:focus.checked,review:review.checked});
    }
    function syncNative(){const native=el("native-basin");if(native&&native.value!==select.value){native.value=select.value;native.dispatchEvent(new Event("change",{bubbles:true}));}}
    select.addEventListener("change",()=>{draw();syncNative();});
    [focus,review].forEach(node=>node.addEventListener("change",draw));
    root.addEventListener("click",event=>{
      const button=event.target.closest("[data-basin]");
      if(!button)return;const site=button.dataset.basin.split(":")[0];
      if(context.basins.some(b=>b.site===site)){select.value=site;draw();syncNative();}
    });
    root.addEventListener("keydown",event=>{if((event.key==="Enter"||event.key===" ")&&event.target.matches("[data-basin]")){event.preventDefault();event.target.click();}});
    el("native-basin")?.addEventListener("change",event=>{if(!event.target.value||context.basins.some(b=>b.site===event.target.value)){select.value=event.target.value;draw();}});
    el("annual-map-download").addEventListener("click",()=>{const svg=el("annual-map-canvas").querySelector("svg");if(!svg)return;
      const url=URL.createObjectURL(new Blob([svg.outerHTML],{type:"image/svg+xml"})),a=document.createElement("a");
      a.href=url;a.download="annual-reference-"+(select.value||"all")+(review.checked?"-components":"")+".svg";a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);});
    draw();
  }catch(error){el("annual-map-description").textContent="Original basin map could not reopen: "+error.message;}
}
export function addAnnualReferenceMapHtml(html,maps) {
  if(html.includes('id="annual-basin-geography"'))throw Error("The annual basin view is already composed.");
  const context=maps.context,display=n=>Number(n).toLocaleString("en-US",{maximumFractionDigits:3});
  const ui='<section id="annual-basin-geography"><h2>Five original annual-reference catchments</h2>'+
    '<p>These are the geographic supports of the eleven annual targets. Select a basin to inspect its complete reviewed footprint, whole-basin area and original components. The displayed reach vertex is a label anchor, not an inferred monitoring-station position.</p>'+
    '<div class="review-controls"><label>Reference basin<select id="annual-map-select"><option value="">All five basins</option>'+
    context.basins.map(b=>'<option value="'+esc(b.site)+'">'+esc(b.site+" · "+b.name)+'</option>').join("")+
    '</select></label><label><input id="annual-map-focus" type="checkbox" checked>Fit selected basin</label>'+
    '<label><input id="annual-map-excluded" type="checkbox">Show retained excluded original components</label></div>'+
    '<div id="annual-map-canvas">'+maps.files["annual-reference-basins.svg"]+'</div>'+
    '<p id="annual-map-description" role="status" aria-live="polite">The tributaries and downstream whole basins overlap; do not add their loads as independent parts.</p>'+
    '<button type="button" id="annual-map-download">Download displayed map (SVG)</button>'+
    '<div class="table"><table><caption>Original area denominators and component selection</caption><thead><tr><th>Reference basin</th><th>Whole basin (km²)</th><th>Selected / excluded components</th></tr></thead><tbody>'+
    context.basins.map(b=>'<tr><th scope="row"><button type="button" data-basin="'+esc(b.site)+'">'+esc(b.site+" · "+b.name)+'</button></th><td>'+display(b.area_km2)+'</td><td>'+
      esc(b.selected_component_indices.join(", ")+" / "+(b.omitted_component_indices.join(", ")||"none"))+'</td></tr>').join("")+
    '</tbody></table></div><p class="muted">On narrow screens, scroll the map horizontally to keep its labels readable. Every original vertex is retained. EPSG:3857 Web Mercator is used only for display; the original EPSG:5070 basin areas remain the yield denominators. Dashed outlines identify excluded original components. No station load is distributed to individual HUCs.</p>'+
    '<p><a href="annual-reference-selected-basins.geojson">Selected original basin components (GeoJSON)</a> · <a href="annual-reference-original-components.geojson">All original components, including exclusions (GeoJSON)</a> · <a href="annual-reference-basin-map.json">Original source and relationship context (JSON)</a> · <a href="annual-reference-basins.svg">All-basin map (SVG)</a></p></section>';
  const script=renderFlowMap.toString()+"\n("+annualMapBrowser.toString()+")();";
  const hash=codec.base64Encode(new Uint8Array(sha(script).match(/../g).map(h=>parseInt(h,16))));
  const policy=html.match(/<meta http-equiv="Content-Security-Policy" content="([^"]*)">/);
  if(!policy?.[1].includes("script-src "))throw Error("Maintain the source report content security policy.");
  const updated=policy[1].replace(/script-src ([^;]+)/,(_,s)=>"script-src "+s+" 'sha256-"+hash+"'");
  const payload=JSON.stringify(context).replaceAll("<","\\u003c").replaceAll("\u2028","\\u2028").replaceAll("\u2029","\\u2029");
  return html.replace(policy[0],'<meta http-equiv="Content-Security-Policy" content="'+updated+'">')
    .replace("</head>",'<style>#annual-map-canvas{overflow:auto;border:1px solid #bbb}#annual-map-canvas svg{display:block;width:100%;min-width:720px;height:auto}#annual-basin-geography button{font:inherit;text-align:left}#annual-basin-geography .review-controls{display:flex;flex-wrap:wrap;gap:16px;margin:16px 0}#annual-basin-geography select{max-width:100%;width:100%}#annual-basin-geography .review-controls>label:first-child{flex:1 1 300px}#annual-map-canvas [data-basin]{cursor:pointer}#annual-map-canvas [data-basin]:focus{outline:2px solid #111}@media print{#annual-basin-geography .review-controls,#annual-map-download{display:none}#annual-map-canvas{break-inside:avoid}}</style></head>')
    .replace("<nav>",'<nav><a href="#annual-basin-geography">Annual basin map</a>')
    .replace('<section id="annual-reference-yields">',ui+'<section id="annual-reference-yields">')
    .replace("</body>",'<script id="annual-basin-data" type="application/json">'+payload+'</script><script id="annual-basin-state" type="application/json">null</script><script>'+script+'</script></body>');
}
