/** Exact point/polygon membership on retained GeoJSON coordinates. */
export function locatePoint(point, geometry) {
  if (!Array.isArray(point) || point.length < 2 || !point.slice(0,2).every(Number.isFinite))
    throw Error("Select a finite original point coordinate");
  const [x,y]=point;
  const onSegment=(a,b)=>{
    const dx=b[0]-a[0],dy=b[1]-a[1];
    const cross=(x-a[0])*dy-(y-a[1])*dx;
    const scale=Math.max(1,Math.abs(dx),Math.abs(dy));
    const eps=Number.EPSILON*64*scale;
    return Math.abs(cross)<=eps && x>=Math.min(a[0],b[0])-eps && x<=Math.max(a[0],b[0])+eps &&
      y>=Math.min(a[1],b[1])-eps && y<=Math.max(a[1],b[1])+eps;
  };
  function ringPosition(ring) {
    if (!Array.isArray(ring)||ring.length<4) throw Error("Select a complete original polygon ring");
    let inside=false;
    for(let i=0,j=ring.length-1;i<ring.length;j=i++){
      const a=ring[j],b=ring[i];
      if(!a.slice(0,2).every(Number.isFinite)||!b.slice(0,2).every(Number.isFinite))
        throw Error("Original polygon contains nonfinite coordinates");
      if(onSegment(a,b))return "boundary";
      if(((a[1]>y)!==(b[1]>y)) && x<(b[0]-a[0])*(y-a[1])/(b[1]-a[1])+a[0])
        inside=!inside;
    }
    return inside?"inside":"outside";
  }
  const polygons=geometry.type==="Polygon"?[geometry.coordinates]:
    geometry.type==="MultiPolygon"?geometry.coordinates:null;
  if(!polygons)throw Error("Select Polygon or MultiPolygon source geometry");
  let boundary=false;
  for(const rings of polygons){
    if(!rings.length)throw Error("Original polygon has no outer ring");
    const outer=ringPosition(rings[0]);
    if(outer==="outside")continue;
    if(outer==="boundary"){boundary=true;continue;}
    let inHole=false;
    for(const hole of rings.slice(1)){
      const located=ringPosition(hole);
      if(located==="boundary"){boundary=true;inHole=true;break;}
      if(located==="inside"){inHole=true;break;}
    }
    if(!inHole)return "inside";
  }
  return boundary?"boundary":"outside";
}

export function nearestBoundaryCoordinate(point, geometry) {
  const polygons=geometry.type==="Polygon"?[geometry.coordinates]:geometry.coordinates;
  let best=null;
  for(const polygon of polygons)for(const ring of polygon)for(let i=1;i<ring.length;i++){
    const a=ring[i-1],b=ring[i],dx=b[0]-a[0],dy=b[1]-a[1],length=dx*dx+dy*dy;
    const t=length?Math.max(0,Math.min(1,((point[0]-a[0])*dx+(point[1]-a[1])*dy)/length)):0;
    const coordinate=[a[0]+t*dx,a[1]+t*dy];
    const squared=(point[0]-coordinate[0])**2+(point[1]-coordinate[1])**2;
    if(!best||squared<best.squared_degrees)best={coordinate,squared_degrees:squared};
  }
  if(!best)throw Error("Original catchment has no retained boundary segments");
  return best.coordinate;
}

export const SOURCE_INPUTS=[
 {path:"derived/station-basin-bindings.json",bytes:24197,sha256:"82ef58d3033676582d1759b08a64cf1d9be3528f12860c1817a9378697691cc4"},
 {path:"derived/upstream-whole-catchments.geojson",bytes:838639,sha256:"649768194700a001ea8fe0f15f3022a314f70551aed67b6c37d08e8edf16902b"}
];
const csv=(rows,columns)=>{
 const quote=value=>{const text=value==null?"":String(value);return /[",\r\n]/.test(text)?'"'+text.replaceAll('"','""')+'"':text;};
 return [columns.join(","),...rows.map(row=>columns.map(key=>quote(row[key])).join(","))].join("\n")+"\n";
};
export function analyzeOriginalSupport(inputText,hash) {
 const bytes=text=>unescape(encodeURIComponent(text)).length;
 for(const input of SOURCE_INPUTS)if(!inputText[input.path]||bytes(inputText[input.path])!==input.bytes||hash(inputText[input.path])!==input.sha256)
   throw Error("Original geographic source differs: "+input.path);
 const binding=JSON.parse(inputText[SOURCE_INPUTS[0].path]),collection=JSON.parse(inputText[SOURCE_INPUTS[1].path]);
 if(binding.schema!=="upstate.station-basin-bindings/v1"||collection.type!=="FeatureCollection")
   throw Error("Select the original source-bound station and catchment edition");
 const stations=binding.stations,basins=collection.features;
 if(stations.length!==13||basins.length!==13||new Set(stations.map(s=>s.station_id)).size!==13||
    new Set(basins.map(b=>b.properties.basin_id)).size!==13)throw Error("Retain all 13 original distinct stations and whole catchments");
 const rows=[],summaries=[];
 for(const station of stations){
  if(station.query_simplified!==false||station.query_split_catchment!==false)
    throw Error("Retain original unsimplified whole-catchment support");
  const point=[station.nldi_longitude,station.nldi_latitude];
  const own=basins.find(b=>b.properties.basin_id===station.basin_id);
  if(!own||own.properties.station_id!==station.station_id||own.properties.comid!==station.comid)
    throw Error("Original station/catchment identity changed");
  for(const basin of basins)rows.push({
    station_id:station.station_id,ts_id:station.ts_id,basin_id:basin.properties.basin_id,
    basin_station_id:basin.properties.station_id,point_longitude:point[0],point_latitude:point[1],
    relation:locatePoint(point,basin.geometry),same_station:station.station_id===basin.properties.station_id,
    point_original_sha256:station.feature_original_sha256,basin_original_sha256:basin.properties.basin_original_sha256
  });
  const relation=locatePoint(point,own.geometry),nearest=nearestBoundaryCoordinate(point,own.geometry);
  summaries.push({
    station_id:station.station_id,station_name:station.station_name,ts_id:station.ts_id,
    comid:station.comid,reachcode:station.reachcode,reach_measure:station.measure,
    own_basin_id:station.basin_id,own_basin_relation:relation,
    nldi_longitude:point[0],nldi_latitude:point[1],
    nwis_longitude:station.nwis_decimal_longitude,nwis_latitude:station.nwis_decimal_latitude,
    nwis_datum:station.nwis_decimal_datum,
    nearest_boundary_longitude:nearest[0],nearest_boundary_latitude:nearest[1],
    containing_basin_ids:rows.filter(row=>row.station_id===station.station_id&&row.relation!=="outside").map(row=>row.basin_id).join(";"),
    point_original_sha256:station.feature_original_sha256,basin_original_sha256:station.basin_original_sha256,
    source_relation:"Original NLDI location against published unsplit upstream catchment"
  });
 }
 const result={
  schema:"upstate.original-catchment-applicability/v1",edition:"20261013-original-nldi-whole-13-v1",
  source_inputs:SOURCE_INPUTS,
  coordinate_support:"Original NLDI GeoJSON longitude/latitude; original NWIS coordinates and datum retained separately",
  boundary_coordinate_support:"Closest segment coordinate in the original longitude/latitude plane",
  catchment_support:"Unsimplified upstream whole catchments; original splitCatchment=false",
  interpretation:"Point/catchment membership describes the original published support. Network connectivity and gauge-split catchment support retain their own source identities.",
  counts:{stations:stations.length,catchments:basins.length,pairs:rows.length,
    inside:rows.filter(row=>row.relation==="inside").length,
    boundary:rows.filter(row=>row.relation==="boundary").length,
    outside:rows.filter(row=>row.relation==="outside").length,
    own_inside:summaries.filter(row=>row.own_basin_relation==="inside").length,
    own_boundary:summaries.filter(row=>row.own_basin_relation==="boundary").length,
    own_outside:summaries.filter(row=>row.own_basin_relation==="outside").length},
  stations:summaries,point_catchment_pairs:rows
 };
 return {result,files:{
  "derived/gauge-catchment-membership.csv":csv(rows,Object.keys(rows[0])),
  "derived/gauge-catchment-applicability.csv":csv(summaries,Object.keys(summaries[0])),
  "derived/gauge-catchment-applicability.json":JSON.stringify(result,null,2)+"\n"
 }};
}
