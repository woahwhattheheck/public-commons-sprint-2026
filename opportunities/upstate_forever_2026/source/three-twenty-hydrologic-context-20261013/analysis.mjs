/** Original NLDI whole-reach topology and four-station context; no network or file I/O. */
const EARTH_RADIUS_M = 6371008.8;
const rad = n => n * Math.PI / 180;
const fail = message => { throw new Error(message); };
const check = (ok, message) => { if (!ok) fail(message); };
const number = value => typeof value === "number" && Number.isFinite(value);
const copy = value => JSON.parse(JSON.stringify(value));
const point = (value, label) => {
  check(Array.isArray(value) && value.length >= 2 && number(value[0]) && number(value[1]) &&
    Math.abs(value[0]) <= 180 && Math.abs(value[1]) <= 90, "Invalid WGS84 coordinate: " + label);
  return [value[0], value[1]];
};
const nodeKey = p => JSON.stringify(p.slice(0,2));
const idText = value => {
  check((typeof value === "string" || typeof value === "number") && /^[1-9][0-9]*$/.test(String(value)),
    "NLDI COMID must retain a positive integral source identifier.");
  return String(value);
};
export function distanceMetres(a,b) {
  const lat1=rad(a[1]), lat2=rad(b[1]), dl=rad(b[0]-a[0]), dp=lat2-lat1;
  const h=Math.sin(dp/2)**2+Math.cos(lat1)*Math.cos(lat2)*Math.sin(dl/2)**2;
  return 2*EARTH_RADIUS_M*Math.atan2(Math.sqrt(Math.min(1,h)),Math.sqrt(Math.max(0,1-h)));
}
function source(value,label) {
  check(value && typeof value.path==="string" && value.path && /^[a-f0-9]{64}$/.test(value.sha256||"") &&
    Number.isInteger(value.bytes) && value.bytes>=0 && typeof value.uri==="string",
    "Retain exact original source descriptor: "+label);
  return copy(value);
}
function features(packet,label) {
  check(packet && packet.body?.type==="FeatureCollection" && Array.isArray(packet.body.features),
    "Original "+label+" must be a GeoJSON FeatureCollection.");
  source(packet.source,label);
  return packet.body.features;
}
function pointFeature(feature,label) {
  check(feature?.type==="Feature" && feature.geometry?.type==="Point", "Expected original point: "+label);
  return point(feature.geometry.coordinates,label);
}
function continuousLine(feature) {
  const geometry=feature.geometry;
  const parts=(geometry?.type==="LineString" ? [geometry.coordinates] :
    geometry?.type==="MultiLineString" ? geometry.coordinates : null);
  check(parts?.length, "Retain original LineString or MultiLineString reaches.");
  const lines=parts.map((p,i)=>{
    check(Array.isArray(p)&&p.length>=2,"A reach part needs at least two vertices.");
    return p.map((v,j)=>point(v,"reach "+i+"/"+j));
  });
  if(lines.length===1)return lines[0];
  const ends=new Map();
  lines.forEach((line,i)=>{for(const p of [line[0],line.at(-1)]){const k=nodeKey(p);if(!ends.has(k))ends.set(k,[]);ends.get(k).push(i);}});
  check([...ends.values()].every(a=>a.length<=2), "A multipart reach branches at an endpoint.");
  const leaves=[...ends].filter(([,v])=>v.length===1);
  check(leaves.length===2,"A multipart reach must form one connected open line.");
  const output=[],used=new Set();let key=leaves.map(([k])=>k).sort()[0];
  while(used.size<lines.length){
    const candidates=(ends.get(key)||[]).filter(i=>!used.has(i));
    check(candidates.length===1,"A multipart reach contains disconnected or ambiguous pieces.");
    const i=candidates[0], raw=lines[i], line=nodeKey(raw[0])===key?raw:[...raw].reverse();
    output.push(...(output.length?line.slice(1):line)); used.add(i);key=nodeKey(line.at(-1));
  }
  return output;
}
function length(line) { let m=0;for(let i=1;i<line.length;i++)m+=distanceMetres(line[i-1],line[i]);return m; }
function projectOnLine(p,line) {
  let best=null, chainage=0;
  for(let i=1;i<line.length;i++){
    const a=line[i-1],b=line[i],segment=distanceMetres(a,b);
    const cos=Math.cos(rad((a[1]+b[1]+p[1])/3));
    const bx=rad(b[0]-a[0])*cos*EARTH_RADIUS_M,by=rad(b[1]-a[1])*EARTH_RADIUS_M;
    const px=rad(p[0]-a[0])*cos*EARTH_RADIUS_M,py=rad(p[1]-a[1])*EARTH_RADIUS_M;
    const denominator=bx*bx+by*by;
    const t=denominator?Math.max(0,Math.min(1,(px*bx+py*by)/denominator)):0;
    const q=[a[0]+t*(b[0]-a[0]),a[1]+t*(b[1]-a[1])],offset=distanceMetres(p,q);
    const candidate={coordinates:q,offset_m:offset,segment_index:i-1,segment_fraction:t,
      chainage_m:chainage+t*segment};
    if(!best||candidate.offset_m<best.offset_m)best=candidate;
    chainage+=segment;
  }
  return best;
}
function stationInput(station) {
  const label=station.station_id;
  check(typeof label==="string"&&label,"Station identifiers are required.");
  const original=point(station.original?.coordinates,label+" original");
  const originalSource=source(station.original?.source,label+" original");
  const indexedRows=features(station.indexed,label+" indexed feature");
  const matching=indexedRows.filter(f=>f.properties?.identifier==="21SC60WQ_WQX-"+label ||
    f.properties?.identifier===station.monitoring_location_id);
  check(matching.length===1,"One original indexed WQP feature is required for "+label);
  const indexed=matching[0],indexedPoint=pointFeature(indexed,label+" indexed feature");
  const hydros=features(station.hydrolocation,label+" hydrolocation");
  const snapped=hydros.filter(f=>f.properties?.type==="hydrolocation"&&f.properties?.source==="indexed");
  const provided=hydros.filter(f=>f.properties?.source==="provided");
  check(snapped.length===1&&provided.length===1,"Retain original indexed and provided hydrolocation points for "+label);
  const providedPoint=pointFeature(provided[0],label+" provided hydrolocation");
  check(nodeKey(providedPoint)===nodeKey(original),"Hydrolocation query must use the original station coordinates: "+label);
  return {
    station_id:label,monitoring_location_id:indexed.properties.identifier,
    description:station.original.description||"", datum:station.original.datum||"WGS84",
    original_source_record_row:station.original.source_record_row??null,
    original_coordinates:original,indexed_coordinates:indexedPoint,
    snapped_coordinates:pointFeature(snapped[0],label+" snapped hydrolocation"),
    indexed_comid:idText(indexed.properties.comid),snapped_comid:idText(snapped[0].properties.comid),
    original_reachcode:snapped[0].properties.reachcode,
    original_measure:snapped[0].properties.measure,
    original_to_indexed_m:distanceMetres(original,indexedPoint),
    original_to_snapped_m:distanceMetres(original,snapped[0].geometry.coordinates),
    indexed_properties:copy(indexed.properties),hydrolocation_properties:copy(snapped[0].properties),
    original_source:originalSource,indexed_source:source(station.indexed.source,label+" indexed"),
    hydrolocation_source:source(station.hydrolocation.source,label+" hydrolocation")
  };
}
/**
 * navigation.body is the untouched DM flowline collection returned from the
 * declared origin WQP feature; no feature-order or nearest-other-edge inference.
 */
export function analyzeStationNetwork(input) {
  check(input?.navigation?.mode==="DM","This analysis requires original downstream-mainstem (DM) navigation.");
  check(number(input.navigation.distance_km)&&input.navigation.distance_km>0,"Retain the requested navigation distance.");
  check(Array.isArray(input.stations)&&input.stations.length>0,"Retain original station inputs.");
  const stations=input.stations.map(stationInput);
  check(new Set(stations.map(s=>s.station_id)).size===stations.length,"Station identifiers must be distinct.");
  const origin=stations.find(s=>s.station_id===input.navigation.origin_station_id);
  check(origin,"Navigation origin must be one of the retained original stations.");
  const native=features(input.navigation,"downstream mainstem"), edges=[],byId=new Map(),nodes=new Map(),issues=[];
  for(const feature of native){
    const id=idText(feature.properties?.nhdplus_comid??feature.properties?.comid??feature.id);
    if(feature.id!=null)check(idText(feature.id)===id,"Original reach feature ID and COMID disagree.");
    check(!byId.has(id),"Duplicate COMID in the original downstream response: "+id);
    const line=continuousLine(feature),start=nodeKey(line[0]),end=nodeKey(line.at(-1));
    check(start!==end,"A reach has identical endpoints; a linear downstream order is ambiguous: "+id);
    const edge={comid:id,native_feature_index:edges.length,geometry:copy(feature.geometry),
      properties:copy(feature.properties||{}),source_id:feature.id??null,
      line,length_m:length(line),start,end};
    byId.set(id,edge);edges.push(edge);
    for(const key of [start,end]){if(!nodes.has(key))nodes.set(key,[]);nodes.get(key).push(id);}
  }
  const componentSets=[],unvisited=new Set(byId.keys());
  while(unvisited.size){
    const seed=unvisited.values().next().value,pending=[seed],set=[];
    while(pending.length){const id=pending.pop();if(!unvisited.delete(id))continue;set.push(id);
      const e=byId.get(id);for(const key of [e.start,e.end])pending.push(...nodes.get(key).filter(x=>unvisited.has(x)));}
    componentSets.push(set);
  }
  const branches=[...nodes].filter(([,ids])=>ids.length>2).map(([coordinate,ids])=>({coordinates:JSON.parse(coordinate),comids:ids}));
  const originEdge=byId.get(origin.indexed_comid);
  if(!originEdge)issues.push("The navigation response does not contain its indexed origin COMID.");
  if(componentSets.length!==1)issues.push("The retained response has "+componentSets.length+" exact-endpoint components.");
  if(branches.length)issues.push("The downstream response branches at "+branches.length+" original endpoints; a single ordered mainstem is ambiguous.");
  const chain=[],used=new Set();
  if(originEdge&&componentSets.length===1&&!branches.length){
    const leaves=[originEdge.start,originEdge.end].filter(k=>nodes.get(k).length===1);
    if(leaves.length!==1)issues.push("The origin reach does not identify one unique upstream terminal endpoint.");
    else {
      let key=leaves[0],offset=0;
      while(used.size<edges.length){
        const available=nodes.get(key).filter(id=>!used.has(id));
        if(available.length!==1){issues.push("The original mainstem cannot be traversed uniquely.");break;}
        const edge=byId.get(available[0]),reverse=edge.end===key,line=reverse?[...edge.line].reverse():edge.line;
        chain.push({comid:edge.comid,order:chain.length,start_m:offset,end_m:offset+edge.length_m,
          length_m:edge.length_m,source_coordinate_order_reversed:reverse,line});
        offset+=edge.length_m;used.add(edge.comid);key=nodeKey(line.at(-1));
      }
    }
  }
  const ordered=new Map(chain.map(e=>[e.comid,e]));
  for(const station of stations){
    station.indexed_in_navigation=byId.has(station.indexed_comid);
    station.snapped_in_navigation=byId.has(station.snapped_comid);
    station.indexed_snap_same_comid=station.indexed_comid===station.snapped_comid;
    station.position_status="outside_retained_navigation";
    station.distance_from_origin_m=null;
    const edge=ordered.get(station.snapped_comid);
    if(station.indexed_in_navigation&&station.snapped_in_navigation&&!station.indexed_snap_same_comid)
      station.position_status="indexed_and_hydrolocation_comids_differ";
    else if(edge&&station.indexed_snap_same_comid){
      const projection=projectOnLine(station.snapped_coordinates,edge.line);
      station.projection={...projection,comid:edge.comid,mainstem_chainage_m:edge.start_m+projection.chainage_m};
      station.position_status=projection.offset_m<=2?"located_on_declared_reach":"snap_point_off_declared_reach_geometry";
      // NLDI point and line coordinate serialization can differ slightly.
      // A two-metre residual is explicit, never a search for another COMID.
      if(projection.offset_m>2)issues.push(station.station_id+" has a "+projection.offset_m.toFixed(3)+" m residual on its declared COMID.");
    }else if(station.indexed_in_navigation||station.snapped_in_navigation)
      station.position_status="route_or_reference_unresolved";
  }
  const originPosition=stations.find(s=>s.station_id===origin.station_id);
  if(originPosition.position_status==="located_on_declared_reach")
    for(const s of stations)if(s.position_status==="located_on_declared_reach")
      s.distance_from_origin_m=s.projection.mainstem_chainage_m-originPosition.projection.mainstem_chainage_m;
  const pairs=[];
  for(let i=0;i<stations.length;i++)for(let j=i+1;j<stations.length;j++){
    const a=stations[i],b=stations[j],supported=a.distance_from_origin_m!==null&&b.distance_from_origin_m!==null;
    const signed=supported?b.distance_from_origin_m-a.distance_from_origin_m:null;
    pairs.push({station_a:a.station_id,station_b:b.station_id,
      station_a_comid:a.snapped_comid,station_b_comid:b.snapped_comid,
      same_reach:a.snapped_comid===b.snapped_comid,
      relation:!supported?"unresolved":Math.abs(signed)<0.001?"coincident_network_position":
        signed>0?"b_downstream_of_a":"a_downstream_of_b",
      approximate_network_distance_m:supported?Math.abs(signed):null,
      signed_b_minus_a_m:signed,straight_line_original_m:distanceMetres(a.original_coordinates,b.original_coordinates),
      source:"Original DM reach membership plus exact endpoint topology and same-COMID point projection"});
  }
  const upstream=input.upstream?features(input.upstream,"upstream context"):[];
  const sources=[...new Map([
    ...stations.flatMap(s=>[s.original_source,s.indexed_source,s.hydrolocation_source]),
    input.navigation.source,...(input.upstream?[input.upstream.source]:[])
  ].map(s=>[s.path,s])).values()].map(s=>copy(s));
  return {
    schema:"upstate.four-station-hydrologic-context/v1",title:"Three and Twenty Creek — station network context",
    captured_at:input.captured_at||"2026-10-13",
    navigation:{mode:"DM",origin_station_id:origin.station_id,origin_comid:origin.indexed_comid,
      requested_distance_km:input.navigation.distance_km,source:source(input.navigation.source,"navigation")},
    stations,pairs,sources,
    topology:{reach_count:edges.length,ordered_reach_count:chain.length,component_count:componentSets.length,
      component_comids:componentSets,branch_nodes:branches,
      endpoint_matching:"Exact equality of original WGS84 endpoint coordinates; no endpoint snapping",
      complete_order:chain.length===edges.length&&edges.length>0,
      full_reach_length_m:edges.reduce((s,e)=>s+e.length_m,0),issues},
    reaches:edges.map(e=>({comid:e.comid,native_feature_index:e.native_feature_index,source_id:e.source_id,
      properties:e.properties,geometry:e.geometry,length_m:e.length_m,
      order:ordered.get(e.comid)?.order??null,start_m:ordered.get(e.comid)?.start_m??null,
      end_m:ordered.get(e.comid)?.end_m??null,
      source_coordinate_order_reversed:ordered.get(e.comid)?.source_coordinate_order_reversed??null})),
    upstream_context:input.upstream?{source:source(input.upstream.source,"upstream"),features:copy(upstream)}:null,
    methods:{
      geometry:"Original whole NLDI reaches are retained untrimmed. Station locations are separate features.",
      direction:"DM source membership defines downstream scope; exact original endpoints determine a unique path from its origin reach.",
      position:"Hydrolocation is projected only onto its declared COMID, and only when the indexed WQP COMID agrees. A residual over two metres is reported as unresolved.",
      distance:"Approximate spherical geodesic lengths using radius 6,371,008.8 m; local tangent-plane segment projection with interpolated segment length. Distances are geographic network context, not travel time.",
      measure:"Original reachcode and measure are retained verbatim; measure is not substituted for a fraction of COMID geometry length.",
      coordinates:"Original agency station coordinates, NLDI indexed WQP coordinates and NLDI snapped hydrolocations remain separate.",
      scope:"Network relationships and approximate distances do not establish flow, loads, intake concentrations, treatment response or causation."
    },
    references:[
      {title:"USGS NLDI navigation modes and whole-reach scope",uri:"https://api.water.usgs.gov/docs/nldi/navigation/"},
      {title:"USGS NLDI basin and hydrolocation",uri:"https://api.water.usgs.gov/docs/nldi/basin/"}
    ]
  };
}
export function rowsToCsv(rows) {
  if(!rows.length)return "";
  const fields=[...new Set(rows.flatMap(row=>Object.keys(row)))];
  const cell=value=>{const text=value==null?"":typeof value==="object"?JSON.stringify(value):String(value);
    return /[",\r\n]/.test(text)?'"'+text.replace(/"/g,'""')+'"':text;};
  return fields.map(cell).join(",")+"\n"+rows.map(row=>fields.map(key=>cell(row[key])).join(",")).join("\n")+"\n";
}
export function stationNetworkExports(result) {
  const stations=result.stations.map(s=>({
    station_id:s.station_id,monitoring_location_id:s.monitoring_location_id,
    original_longitude:s.original_coordinates[0],original_latitude:s.original_coordinates[1],
    indexed_longitude:s.indexed_coordinates[0],indexed_latitude:s.indexed_coordinates[1],
    snapped_longitude:s.snapped_coordinates[0],snapped_latitude:s.snapped_coordinates[1],
    indexed_comid:s.indexed_comid,snapped_comid:s.snapped_comid,reachcode:s.original_reachcode,measure:s.original_measure,
    indexed_in_navigation:s.indexed_in_navigation,snapped_in_navigation:s.snapped_in_navigation,
    position_status:s.position_status,original_to_indexed_m:s.original_to_indexed_m,
    original_to_snapped_m:s.original_to_snapped_m,projection_residual_m:s.projection?.offset_m??null,
    approximate_distance_from_origin_m:s.distance_from_origin_m,
    original_source_path:s.original_source.path,original_source_sha256:s.original_source.sha256,
    original_source_record_row:s.original_source_record_row,
    projected_longitude:s.projection?.coordinates?.[0]??null,projected_latitude:s.projection?.coordinates?.[1]??null,
    indexed_source_path:s.indexed_source.path,indexed_source_sha256:s.indexed_source.sha256,
    hydrolocation_source_path:s.hydrolocation_source.path,hydrolocation_source_sha256:s.hydrolocation_source.sha256
  }));
  return {
    "station-network-summary.json":JSON.stringify(result,null,2)+"\n",
    "station-locations.csv":rowsToCsv(stations),
    "station-network-pairs.csv":rowsToCsv(result.pairs),
    "original-downstream-reaches.geojson":JSON.stringify({type:"FeatureCollection",features:result.reaches.map(r=>({
      type:"Feature",id:r.source_id,properties:r.properties,geometry:r.geometry}))},null,2)+"\n",
    "station-location-views.geojson":JSON.stringify({type:"FeatureCollection",features:result.stations.flatMap(s=>
      ["original","indexed","snapped","projected"].filter(kind=>kind!=="projected"||s.projection).map(kind=>({
        type:"Feature",id:s.station_id+":"+kind,geometry:{type:"Point",coordinates:kind==="projected"?s.projection.coordinates:s[kind+"_coordinates"]},
        properties:{id:s.station_id+":"+kind,station_id:s.station_id,location_view:kind,
          coordinate_basis:kind==="projected"?"Derived local projection on declared COMID":"Original source coordinate",
          comid:kind==="indexed"?s.indexed_comid:["snapped","projected"].includes(kind)?s.snapped_comid:null,
          source_path:kind==="original"?s.original_source.path:kind==="indexed"?s.indexed_source.path:s.hydrolocation_source.path,
          source_sha256:kind==="original"?s.original_source.sha256:kind==="indexed"?s.indexed_source.sha256:s.hydrolocation_source.sha256}
      })))},null,2)+"\n"
  };
}
