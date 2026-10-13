#!/usr/bin/env node
/** Reproduce the complete original Eighteenmile stream nutrient source joins. */
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {resolve,join,dirname} from 'node:path';
import {createHash} from 'node:crypto';
function parseCSV(text) {
 const records=[];let record=[],cell="",quoted=false;for(let i=0;i<text.length;i++){const c=text[i];if(quoted){if(c==='"'&&text[i+1]==='"'){cell+='"';i++;}else if(c==='"')quoted=false;else cell+=c;}else if(c==='"'){if(cell)throw Error("Quote in unquoted CSV field");quoted=true;}else if(c===","){record.push(cell);cell="";}else if(c==="\n"){record.push(cell.replace(/\r$/,""));if(record.some(v=>v!==""))records.push(record);record=[];cell="";}else cell+=c;}if(quoted)throw Error("Unterminated CSV quote");if(cell||record.length){record.push(cell.replace(/\r$/,""));records.push(record);}const headers=records.shift();return {headers,rows:records.map((values,i)=>{if(values.length!==headers.length)throw Error("CSV columns "+i);return Object.fromEntries(headers.map((h,j)=>[h,values[j]]));})};
}
function inRing(p,ring){let inside=false;for(let i=0,j=ring.length-1;i<ring.length;j=i++){const a=ring[j],b=ring[i],cross=(p[0]-a[0])*(b[1]-a[1])-(p[1]-a[1])*(b[0]-a[0]);if(Math.abs(cross)<=1e-12&&p[0]>=Math.min(a[0],b[0])-1e-12&&p[0]<=Math.max(a[0],b[0])+1e-12&&p[1]>=Math.min(a[1],b[1])-1e-12&&p[1]<=Math.max(a[1],b[1])+1e-12)return "boundary";if((a[1]>p[1])!==(b[1]>p[1])&&p[0]<(b[0]-a[0])*(p[1]-a[1])/(b[1]-a[1])+a[0])inside=!inside;}return inside?"inside":"outside";}
function polygon(p,rings){const out=inRing(p,rings[0]);if(out==="outside"||out==="boundary")return out;for(const hole of rings.slice(1)){const inside=inRing(p,hole);if(inside==="boundary")return"boundary";if(inside==="inside")return"outside";}return"inside";}
function relation(p,body){let boundary=false;for(const f of body.features){const gs=f.geometry.type==="MultiPolygon"?f.geometry.coordinates:[f.geometry.coordinates];for(const g of gs){const r=polygon(p,g);if(r==="inside")return r;if(r==="boundary")boundary=true;}}return boundary?"boundary":"outside";}
function networkRelations(sources, stations) {
  const gaugePath="original/eighteenmile-gauge-network-location.json";
  const upstreamPath="original/eighteenmile-upstream-wqp.json";
  if(!sources[gaugePath]&&!sources[upstreamPath])return null;
  const collection=path=>{
    if(!sources[path])throw Error("Missing original network source: "+path);
    const doc=JSON.parse(sources[path]);
    if(doc.type!=="FeatureCollection"||!Array.isArray(doc.features))throw Error("Original network source is not a FeatureCollection");
    return doc.features;
  };
  const gauges=collection(gaugePath).filter(f=>f.properties?.identifier==="USGS-02186702");
  if(gauges.length!==1)throw Error("Expected one original gauge network feature");
  const gauge=gauges[0].properties;
  const validMeasure=v=>typeof v==="number"&&Number.isFinite(v)&&v>=0&&v<=100;
  if(!gauge.reachcode||!validMeasure(gauge.measure))throw Error("Gauge has no original linear reference");
  const upstream=collection(upstreamPath);
  const answer=new Map();
  for(const station of stations){
    const id=station.MonitoringLocationIdentifier;
    const suffix=station.MonitoringLocationName.toLowerCase().replace("-","");
    const path="original/eighteenmile-"+suffix+"-hydrolocation.json";
    const features=collection(path), indexed=features.filter(f=>f.properties?.source==="indexed"),provided=features.filter(f=>f.properties?.source==="provided");
    if(indexed.length!==1||provided.length!==1)throw Error("Expected one indexed and provided station point: "+id);
    const originalPoint=[Number(station.LongitudeMeasure),Number(station.LatitudeMeasure)];
    if(JSON.stringify(provided[0].geometry?.coordinates)!==JSON.stringify(originalPoint))throw Error("Hydrolocation used different original station coordinates: "+id);
    const feature=indexed[0],location=feature.properties,point=feature.geometry?.coordinates;
    if(feature.geometry?.type!=="Point"||point?.length!==2||!point.every(Number.isFinite)||!location.reachcode||!validMeasure(location.measure))throw Error("Station has no original linear reference: "+id);
    const matches=upstream.filter(f=>f.properties?.identifier===id);
    if(matches.length>1)throw Error("Repeated original upstream station index: "+id);
    const indexedMatch=matches.length===1&&Number(matches[0].properties.comid)===Number(location.comid);
    let relation="not_in_retained_upstream_index";
    if(location.reachcode===gauge.reachcode){
      relation=location.measure<gauge.measure?"downstream_same_reach":location.measure>gauge.measure?"upstream_same_reach":"coincident_linear_reference";
    }else if(indexedMatch)relation="indexed_upstream_reach";
    else if(matches.length)relation="station_index_differs_from_hydrolocation";
    answer.set(id,{
      gauge_network_relation:relation,gauge_network_source:"USGS NLDI",
      station_network_comid:location.comid,station_network_reachcode:location.reachcode,station_network_measure:location.measure,
      station_indexed_longitude:point[0],station_indexed_latitude:point[1],
      gauge_network_comid:gauge.comid,gauge_network_reachcode:gauge.reachcode,gauge_network_measure:gauge.measure,
      original_upstream_index_contains_station:matches.length===1,
      original_upstream_index_matches_hydrolocation:indexedMatch,
      network_station_source:path,network_gauge_source:gaugePath,network_upstream_source:upstreamPath
    });
  }
  return answer;
}
function deriveNutrients(sources) {
  const compare=(a,b)=>a<b?-1:a>b?1:0;
  const stations = parseCSV(sources["original/seneca-nutrient-stations.csv"]).rows;
  const full = JSON.parse(sources["original/eighteenmile-whole-reach-basin.geojson"]);
  const split = sources["original/eighteenmile-gauge-basin.geojson"] ? JSON.parse(sources["original/eighteenmile-gauge-basin.geojson"]) : null;
  const expected = new Set(["21SC60WQ_WQX-SV-233","21SC60WQ_WQX-SV-245","21SC60WQ_WQX-SV-375","21SC60WQ_WQX-SV-376"]);
  const rows=[];
  for (const file of ["original/nutrient-results-2020-2022.csv","original/nutrient-results-2023-2025.csv"]) {
    const parsed=parseCSV(sources[file]);
    if(parsed.headers.length!==63)throw Error("Original result schema differs: "+file);
    for(const [i,row] of parsed.rows.entries()) {
      if(!expected.has(row.MonitoringLocationIdentifier))throw Error("Unexpected original stream station");
      rows.push({...row,source_file:file,source_row:i+2});
    }
  }
  const selected=stations.filter(s=>expected.has(s.MonitoringLocationIdentifier));
  if(selected.length!==4||new Set(selected.map(s=>s.MonitoringLocationIdentifier)).size!==4)throw Error("Missing or repeated original station");
  const network=networkRelations(sources,selected);
  const stationRows=selected.map(s=>{
    if(s.HorizontalCoordinateReferenceSystemDatumName!=="WGS84")throw Error("Station needs an explicit original-datum transform");
    const p=[Number(s.LongitudeMeasure),Number(s.LatitudeMeasure)];
    if(!p.every(Number.isFinite))throw Error("Invalid original coordinate");
    const rs=rows.filter(r=>r.MonitoringLocationIdentifier===s.MonitoringLocationIdentifier);
    const dates=rs.map(r=>r.ActivityStartDate).sort();
    return {station_id:s.MonitoringLocationIdentifier,station_name:s.MonitoringLocationName,description:s.MonitoringLocationDescriptionText,type:s.MonitoringLocationTypeName,longitude:p[0],latitude:p[1],datum:s.HorizontalCoordinateReferenceSystemDatumName,original_huc8:s.HUCEightDigitCode,full_reach_basin_relation:relation(p,full),...(network?network.get(s.MonitoringLocationIdentifier):{}),...(split?{gauge_split_basin_relation:relation(p,split)}:{}),records:rs.length,activities:new Set(rs.map(r=>r.ActivityIdentifier)).size,start_date:dates[0],end_date:dates.at(-1)};
  });
  const byStation=new Map(stationRows.map(s=>[s.station_id,s]));
  const values=rows.map(r=>{
    const hasValue=r.ResultMeasureValue!=="",limit=r["DetectionQuantitationLimitMeasure/MeasureValue"];
    if(hasValue&&!Number.isFinite(Number(r.ResultMeasureValue)))throw Error("Nonnumeric original result");
    if(limit!==""&&!Number.isFinite(Number(limit)))throw Error("Nonnumeric original limit");
    const s=byStation.get(r.MonitoringLocationIdentifier);
    return {station_id:r.MonitoringLocationIdentifier,activity_id:r.ActivityIdentifier,date:r.ActivityStartDate,time:r["ActivityStartTime/Time"],time_zone:r["ActivityStartTime/TimeZoneCode"],characteristic:r.CharacteristicName,sample_fraction:r.ResultSampleFractionText,value:r.ResultMeasureValue,unit:r["ResultMeasure/MeasureUnitCode"],detection_condition:r.ResultDetectionConditionText,limit_type:r.DetectionQuantitationLimitTypeName,limit_value:limit,limit_unit:r["DetectionQuantitationLimitMeasure/MeasureUnitCode"],result_status:r.ResultStatusIdentifier,result_type:r.ResultValueTypeName,qualifier:r.MeasureQualifierCode,method_id:r["ResultAnalyticalMethod/MethodIdentifier"],method_context:r["ResultAnalyticalMethod/MethodIdentifierContext"],method_name:r["ResultAnalyticalMethod/MethodName"],...(split?{gauge_split_basin_relation:s.gauge_split_basin_relation}:{}),full_reach_basin_relation:s.full_reach_basin_relation,...(network?{gauge_network_relation:s.gauge_network_relation,station_network_comid:s.station_network_comid,station_network_reachcode:s.station_network_reachcode,station_network_measure:s.station_network_measure}:{}),source_file:r.source_file,source_row:r.source_row};
  });
  values.sort((a,b)=>compare(a.station_id,b.station_id)||compare(a.date,b.date)||compare(a.activity_id,b.activity_id)||compare(a.characteristic,b.characteristic)||compare(a.source_file,b.source_file)||a.source_row-b.source_row);
  const groups=new Map();
  for(const r of values){
    const key=JSON.stringify([r.station_id,r.date.slice(0,4),r.characteristic,r.sample_fraction]);
    if(!groups.has(key))groups.set(key,{station_id:r.station_id,year:r.date.slice(0,4),characteristic:r.characteristic,sample_fraction:r.sample_fraction,records:0,numeric_records:0,below_quantification_records:0,activities:new Set(),units:new Set(),limits:new Set(),methods:new Set(),...(network?{gauge_network_relation:r.gauge_network_relation}:{}),...(split?{gauge_split_basin_relation:r.gauge_split_basin_relation}:{})});
    const g=groups.get(key);g.records++;g.numeric_records+=r.value!==""?1:0;g.below_quantification_records+=r.detection_condition==="Present Below Quantification Limit"?1:0;g.activities.add(r.activity_id);if(r.unit)g.units.add(r.unit);if(r.limit_value!=="")g.limits.add(r.limit_value+" "+r.limit_unit);g.methods.add(r.method_context+":"+r.method_id);
  }
  const coverage=[...groups.values()].map(g=>({...g,activities:g.activities.size,units:[...g.units].sort().join(" | "),limits:[...g.limits].sort().join(" | "),methods:[...g.methods].sort().join(" | ")}));
  const summary={schema:"upstate.eighteenmile-nutrient-source/v1",gauge:"USGS-02186702",records:values.length,activities:new Set(values.map(r=>r.activity_id)).size,stations:stationRows,characteristics:Object.fromEntries([...new Set(values.map(r=>r.characteristic))].sort().map(k=>[k,values.filter(r=>r.characteristic===k).length])),numeric_records:values.filter(r=>r.value!=="").length,below_quantification_records:values.filter(r=>r.detection_condition==="Present Below Quantification Limit").length,spatial_method:"Point-in-original-GeoJSON-polygon with all original exterior rings and holes, boundary retained explicitly; WGS84 station points. Original full-reach response uses splitCatchment=false. A supplied split-at-gauge response is evaluated separately.",network_method:network?"Original station coordinates are bound to original NLDI hydrolocations. On an identical ReachCode, the smaller original measure is downstream (NHD measure 0 at downstream end, 100 at upstream end). Different reaches are labeled indexed_upstream_reach only when the original gauge UT/WQP query includes that station and its COMID matches the station hydrolocation. This network relation is separate from point-in-polygon gauge split membership.":null,original_fields:"All 63 WQP result fields remain in the two original date-query responses. Derived source_file/source_row point to their exact original CSV records.",units:"Original result and detection-limit units retained independently. Blank measured results remain blank; limits are not substituted for measurements.",source_interval:"2020-01-01 through 2025-12-31 inclusive publisher query"};
  const csv=items=>{if(!items.length)return"";const headers=Object.keys(items[0]);const cell=v=>{const s=String(v??"");return /[",\r\n]/.test(s)?'"'+s.replaceAll('"','""')+'"':s};return headers.map(cell).join(",")+"\n"+items.map(r=>headers.map(h=>cell(r[h])).join(",")).join("\n")+"\n"};
  return {...(network?{"derived/station-network-context.csv":csv(stationRows.map(s=>({station_id:s.station_id,station_name:s.station_name,original_longitude:s.longitude,original_latitude:s.latitude,...network.get(s.station_id)})))}:{}),"derived/station-basin-join.csv":csv(stationRows),"derived/nutrient-results.csv":csv(values),"derived/station-year-characteristic-coverage.csv":csv(coverage),"derived/source-summary.json":JSON.stringify(summary,null,2)+"\n"};
}
const root=resolve(process.argv[2]||'.'),output=resolve(process.argv[3]||root);
const manifest=JSON.parse(readFileSync(join(root,'source-manifest.json'),'utf8'));
const source={};
for(const original of manifest.originals){
  if(!/^original\/[a-zA-Z0-9._-]+$/.test(original.path))throw Error('Source path is not a retained original member');
  const raw=readFileSync(join(root,original.path));
  if(raw.length!==original.bytes||createHash('sha256').update(raw).digest('hex')!==original.sha256)
    throw Error('Original source bytes differ: '+original.path);
  source[original.path]=raw.toString('utf8');
}
const outputs=deriveNutrients(source);
for(const [name,content] of Object.entries(outputs)){
  const path=join(output,name);mkdirSync(dirname(path),{recursive:true});writeFileSync(path,content,'utf8');
}
const summary=JSON.parse(outputs['derived/source-summary.json']);
process.stdout.write(JSON.stringify({records:summary.records,activities:summary.activities,
  stations:summary.stations.map(s=>({id:s.station_id,full_reach:s.full_reach_basin_relation,gauge_split:s.gauge_split_basin_relation})),
  outputs:Object.keys(outputs)},null,2)+'\n');
