// Copyright TokenJunkieLabs. Original publisher source associations, with native fields retained.
import { createArchiveCodec } from "./archive_codec.mjs";
const codec = createArchiveCodec();
export const INPUTS = Object.freeze({
  stations: {path:"source_data/scdes_savannah705_20261013/scdes-savannah705-native.esri.json",bytes:1043696,sha256:"14b1a945ee8d5f172f63435b4fd955e9dada6894fcbca2964160c6e2e52d79f0"},
  published2024: {path:"source/water-quality-assessments/20261013/inputs/303d-2024-pdf-table-normalized.json",bytes:2674649,sha256:"69e6894001fdcfa0130d8be532a31655eda22486a4044079665e8ee614eb5b0c"},
  tmdl2026: {path:"source/water-quality-assessments/20261013/inputs/tmdl-attainment-native-20260728.json",bytes:1260570,sha256:"cceaf00eb0fc4cc85eabb67fbd2a9b5d843bb0cc0c7ab8da54d2108f025c2522"},
  domain: {path:"source/water-quality-assessments/20261013/inputs/domain-huc12s.json",bytes:3257,sha256:"a8e83c835b97440f21077fd09d41dcd48d3b07711f371bb839f9c483ecca314f"}
});
const fail = message => { throw new Error("assessment source audit: "+message); };
const unique = values => [...new Set(values)].sort();
const tuple = row => JSON.stringify([row.source_id,row.id]);
const json = value => JSON.stringify(value,null,2)+"\n";
const sha = text => codec.sha256(codec.utf8Encode(text));
function read(name,text) {
  if(typeof text!=="string")fail("retain complete UTF-8 "+name+" input");
  const bytes=codec.utf8Encode(text),expected=INPUTS[name];
  if(bytes.length!==expected.bytes||codec.sha256(bytes)!==expected.sha256)fail("original input identity differs: "+name);
  try{return JSON.parse(text);}catch{fail("original input is not JSON: "+name);}
}
function csv(rows,fields) {
  const quote=value=>{
    let s=value===null||value===undefined?"":typeof value==="object"?JSON.stringify(value):String(value);
    const trimmed=s.trimStart();
    if(/^[=+@\t\r]/.test(s)||/^[=+@]/.test(trimmed)||
      (trimmed.startsWith("-")&&!/^-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(trimmed)))s="'"+s;
    return '"'+s.replaceAll('"','""')+'"';
  };
  return "\uFEFF"+[fields.map(quote).join(","),...rows.map(row=>fields.map(k=>quote(row[k])).join(","))].join("\r\n")+"\r\n";
}
export function auditAssessmentStationSources(input) {
  const native=read("stations",input.stations), published=read("published2024",input.published2024),
    tmdl=read("tmdl2026",input.tmdl2026), ids=read("domain",input.domain);
  const domain=new Set(ids);
  if(ids.length!==217||domain.size!==ids.length||ids.some(h=>typeof h!=="string"||!/^\d{12}$/.test(h)))fail("original domain identifiers differ");
  if(native.geometryType!=="esriGeometryPoint"||native.spatialReference?.wkid!==26917||native.features?.length!==705)
    fail("original native point source shape differs");
  const nativeBy=new Map(), nativeIds=new Set();
  const stations=native.features.map((feature,index)=>{
    const attr=feature.attributes, geom=feature.geometry;
    if(!attr||typeof attr.STAT!=="string"||!attr.STAT||nativeBy.has(attr.STAT)||
      !Number.isSafeInteger(attr.OBJECTID)||nativeIds.has(attr.OBJECTID)||
      !geom||!Number.isFinite(geom.x)||!Number.isFinite(geom.y))fail("native station identity or original geometry differs");
    nativeIds.add(attr.OBJECTID);
    const validHuc=typeof attr.HUC_12==="string"&&/^\d{12}$/.test(attr.HUC_12);
    const row={station_id:attr.STAT,native_feature_id:attr.OBJECTID,native_feature_index:index,
      source_pointer:"/features/"+index,source_sha256:INPUTS.stations.sha256,
      source_crs:"EPSG:26917",publisher_huc_raw:attr.HUC_12,
      publisher_huc_status:validHuc?"reported_huc12":"not_twelve_digit_huc12",
      publisher_huc12:validHuc?attr.HUC_12:null,
      station_publisher_in_selected_domain:validHuc?domain.has(attr.HUC_12):null,
      original_feature:feature,assessment_record_keys:[]};
    nativeBy.set(attr.STAT,row);return row;
  });
  const keys=new Set(),assessments=[];
  for(const [inputName,bank,expected] of [["published2024",published,1516],["tmdl2026",tmdl,813]]) {
    if(bank.schema!=="upstate.water-quality-assessments/v1"||bank.complete!==true||
      !Array.isArray(bank.unparsed_rows)||bank.unparsed_rows.length||bank.records?.length!==expected)
      fail("retain the complete normalized edition: "+inputName);
    bank.records.forEach((original,index)=>{
      const key=tuple(original);
      if(typeof original.id!=="string"||!original.id||original.source_id!==bank.source.source_id||
        original.source_sha256!==bank.source.source_sha256||keys.has(key)||
        typeof original.site!=="string"||typeof original.huc12!=="string"||!/^\d{12}$/.test(original.huc12))
        fail("assessment identity differs: "+inputName+"/"+index);
      keys.add(key);
      const station=nativeBy.get(original.site),nativeHuc=station?.publisher_huc12;
      let relation=!station?"absent_from_selected_native705":!nativeHuc?"native_publisher_huc12_unreported":
        nativeHuc===original.huc12?"same_publisher_huc12":"different_publisher_huc12";
      const row={record_key:key,input_name:inputName,normalized_body_sha256:INPUTS[inputName].sha256,
        normalized_record_pointer:"/records/"+index,source_id:original.source_id,id:original.id,site:original.site,
        source_vintage:original.source_vintage,assessment_publisher_huc12:original.huc12,
        assessment_publisher_in_selected_domain:domain.has(original.huc12),
        native_station_match:station?{station_id:station.station_id,native_feature_id:station.native_feature_id,
          native_feature_index:station.native_feature_index,source_pointer:station.source_pointer,
          source_sha256:station.source_sha256,source_crs:station.source_crs,
          x:station.original_feature.geometry.x,y:station.original_feature.geometry.y,
          publisher_huc_raw:station.publisher_huc_raw,publisher_huc12:nativeHuc,
          station_publisher_in_selected_domain:station.station_publisher_in_selected_domain}:null,
        publisher_relationship:relation,original_assessment:original};
      if(station)station.assessment_record_keys.push(key);
      assessments.push(row);
    });
  }
  const matched=assessments.filter(r=>r.native_station_match),differences=matched.filter(r=>r.publisher_relationship==="different_publisher_huc12");
  const quadrants={};
  for(const row of matched) {
    const key=(row.assessment_publisher_in_selected_domain?"inside":"outside")+"/"+
      (row.native_station_match.station_publisher_in_selected_domain===null?"unreported":row.native_station_match.station_publisher_in_selected_domain?"inside":"outside");
    quadrants[key]=(quadrants[key]||0)+1;
  }
  const invalid=stations.filter(r=>r.publisher_huc_status!=="reported_huc12");
  const summary={native_station_count:stations.length,statewide_assessment_records:assessments.length,
    matched_assessment_records:matched.length,matched_native_stations:unique(matched.map(r=>r.site)).length,
    native_stations_without_selected_assessment_records:stations.filter(r=>!r.assessment_record_keys.length).length,
    unmatched_statewide_assessment_records:assessments.length-matched.length,
    differing_publisher_huc12_records:differences.length,
    invalid_native_publisher_huc12_count:invalid.length,
    selected_domain_assessment_records:assessments.filter(r=>r.assessment_publisher_in_selected_domain).length,
    selected_domain_native_matched_records:matched.filter(r=>r.assessment_publisher_in_selected_domain).length,
    publisher_domain_quadrants:quadrants,
    assessment_editions:unique(assessments.map(r=>r.source_id)).map(source_id=>{
      const rows=assessments.filter(r=>r.source_id===source_id),own=rows.filter(r=>r.native_station_match);
      return {source_id,records:rows.length,native_matched_records:own.length,native_matched_stations:unique(own.map(r=>r.site)).length,
        differing_publisher_huc12_records:own.filter(r=>r.publisher_relationship==="different_publisher_huc12").length};
    })};
  const result={schema:"upstate.assessment-station-source-audit/v1",
    title:"Complete Savannah station source and statewide published assessment comparison",vintage:"2026-10-13",
    source_selection:{native_stations:"Original BASIN='Savannah' provider selection",
      assessment_editions:"Complete published2024 and July2026 statewide normalized source bodies",
      station_association:"Exact original STAT to assessment site identifier",
      spatial_membership:"Native station geometry and CRS remain unchanged; publisher HUC labels are compared independently of point/polygon membership."},
    inputs:INPUTS,domain_huc12s:ids,summary,
    interpretation:[
      "An assessment absent from the selected native705 source remains an original assessment; absence describes this source selection.",
      "A native station with zero matching records has no record in these two selected assessment editions.",
      "Both original publisher HUC labels, counties, descriptions and source identities are retained.",
      "Eleven-digit native HUC attributes remain their exact source strings; the audit does not pad or assign them.",
      "The existing217-HUC report retains its192 assessment-publisher-selected records; station-based selection is separately identified."
    ],stations,assessments,
    differing_record_keys:differences.map(r=>r.record_key),
    invalid_native_huc_station_ids:invalid.map(r=>r.station_id)};
  const flat=assessments.map(row=>({record_key:row.record_key,source_id:row.source_id,id:row.id,site:row.site,
    vintage:row.source_vintage,assessment_huc12:row.assessment_publisher_huc12,
    assessment_in_domain:row.assessment_publisher_in_selected_domain,
    native_station_id:row.native_station_match?.station_id||"",native_feature_id:row.native_station_match?.native_feature_id??"",
    station_huc_raw:row.native_station_match?.publisher_huc_raw??"",station_huc12:row.native_station_match?.publisher_huc12??"",
    station_in_domain:row.native_station_match?.station_publisher_in_selected_domain??"",
    relationship:row.publisher_relationship,cause:row.original_assessment.cause_code||row.original_assessment.cause_raw,
    use:row.original_assessment.use,support:row.original_assessment.use_support,
    source_page:row.original_assessment.source_page,assessment_county:row.original_assessment.county,
    native_county:row.native_station_match?nativeBy.get(row.site).original_feature.attributes.COUNTY:"",
    native_crs:row.native_station_match?.source_crs||"",native_x:row.native_station_match?.x??"",native_y:row.native_station_match?.y??"",
    assessment_body_sha256:row.normalized_body_sha256,assessment_pointer:row.normalized_record_pointer,
    native_body_sha256:row.native_station_match?.source_sha256||"",native_pointer:row.native_station_match?.source_pointer||""}));
  const stationRows=stations.map(s=>({site:s.station_id,native_feature_id:s.native_feature_id,native_pointer:s.source_pointer,
    huc_raw:s.publisher_huc_raw,huc_status:s.publisher_huc_status,in_domain:s.station_publisher_in_selected_domain,
    assessment_records:s.assessment_record_keys.length,assessment_record_keys:s.assessment_record_keys,
    county:s.original_feature.attributes.COUNTY,description:s.original_feature.attributes.DESCRIPT,
    native_crs:s.source_crs,native_x:s.original_feature.geometry.x,native_y:s.original_feature.geometry.y}));
  const files={"assessment-station-source-audit.json":JSON.stringify(result)+"\n","source-audit-summary.json":json(summary),
    "all-statewide-assessment-source-associations.csv":csv(flat,Object.keys(flat[0])),
    "publisher-huc-differences.csv":csv(flat.filter(r=>r.relationship==="different_publisher_huc12"),Object.keys(flat[0])),
    "all-native-station-source-coverage.csv":csv(stationRows,Object.keys(stationRows[0]))};
  files["artifacts.json"]=json({schema:"commons.artifacts/v1",source_inputs:INPUTS,files:Object.entries(files).map(([path,body])=>({path,bytes:codec.utf8Encode(body).length,sha256:sha(body)}))});
  return {result,files};
}
