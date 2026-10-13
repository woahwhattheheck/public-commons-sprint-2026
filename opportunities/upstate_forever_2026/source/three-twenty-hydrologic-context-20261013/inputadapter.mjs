export const ROOT="source/three-twenty-hydrologic-context-20261013";
export const MANIFEST="three_twenty_hydrologic_context.sources.json";
export function makeNetworkInput(files,parseCsv){
 const demand=(value,message)=>{if(!value)throw Error(message);return value};
 const stations=["SV-833","RS-26250","SV-735","SV-111"];
 const pick=(station,role)=>{const rows=files.filter(f=>f.station===station&&f.role===role);demand(rows.length===1,"Expected one original "+station+" "+role);return rows[0];};
 const source=f=>({path:f.path,bytes:f.bytes,sha256:f.sha256,uri:f.uri});
 const originalJson=(station,role)=>{const f=pick(station,role),body=JSON.parse(f.content);demand(body.type==="FeatureCollection"&&Array.isArray(body.features),"Expected original FeatureCollection: "+f.path);return {body,source:source(f)};};
 demand(files.length===14&&new Set(files.map(f=>f.path)).size===14,"Retain the complete fourteen original inputs.");
 const locations=stations.map(station_id=>{
  const f=pick(station_id,"station_catalogue"),rows=parseCsv(f.content),identifier="21SC60WQ_WQX-"+station_id;
  const found=rows.map((row,index)=>({row,index})).filter(x=>x.row.MonitoringLocationIdentifier===identifier);
  demand(found.length===1,"Expected one unchanged original station record: "+station_id);
  const {row,index}=found[0],coordinates=[Number(row.LongitudeMeasure),Number(row.LatitudeMeasure)];
  demand(coordinates.every(Number.isFinite)&&Math.abs(coordinates[0])<=180&&Math.abs(coordinates[1])<=90,"Invalid original coordinates");
  demand(row.HorizontalCoordinateReferenceSystemDatumName==="WGS84","Retain the original station datum");
  return {station_id,original:{coordinates,source:source(f),monitoring_location_id:identifier,description:row.MonitoringLocationDescriptionText,datum:"WGS84",source_record_row:index+2},indexed:originalJson(station_id,"feature"),hydrolocation:originalJson(station_id,"hydrolocation")};
 });
 return {stations:locations,navigation:{origin_station_id:"SV-833",mode:"DM",distance_km:100,...originalJson("SV-833","downstream_flowlines")},upstream:originalJson("SV-833","upstream_flowlines")};
}
