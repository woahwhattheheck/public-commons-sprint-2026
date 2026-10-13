#!/usr/bin/env node
/** Reproduce the installed stream study from its five unchanged public originals. */
import {readFileSync,writeFileSync,mkdirSync} from "node:fs";
import {resolve,dirname,join} from "node:path";
import {createHash} from "node:crypto";
import {fileURLToPath} from "node:url";
function parseCSV(t){const rows=[];let row=[],v="",q=false;for(let i=0;i<t.length;i++){const c=t[i];if(q){if(c==='"'){if(t[i+1]==='"'){v+='"';i++}else q=false}else v+=c}else if(c==='"'){if(v)throw Error("quote inside bare field");q=true}else if(c===','){row.push(v);v=''}else if(c==='\r'||c==='\n'){if(c==='\r'&&t[i+1]==='\n')i++;row.push(v);if(row.some(x=>x!==''))rows.push(row);row=[];v=''}else v+=c}if(q)throw Error("unclosed quote");if(v||row.length){row.push(v);rows.push(row)}const h=rows.shift();if(new Set(h).size!==h.length)throw Error("duplicate header");return {header:h,rows:rows.map((r,i)=>{if(r.length!==h.length)throw Error("width "+i);return Object.fromEntries(h.map((k,j)=>[k,r[j]]))})}}
function ringStatus(p,ring){let inside=false;for(let i=0,j=ring.length-1;i<ring.length;j=i++){const a=ring[j],b=ring[i];let cross=(p[0]-a[0])*(b[1]-a[1])-(p[1]-a[1])*(b[0]-a[0]);if(Math.abs(cross)<1e-12&&p[0]>=Math.min(a[0],b[0])-1e-12&&p[0]<=Math.max(a[0],b[0])+1e-12&&p[1]>=Math.min(a[1],b[1])-1e-12&&p[1]<=Math.max(a[1],b[1])+1e-12)return "boundary";if((a[1]>p[1])!==(b[1]>p[1])&&p[0]<(b[0]-a[0])*(p[1]-a[1])/(b[1]-a[1])+a[0])inside=!inside;}return inside?"inside":"outside";}function polygonStatus(p,rings){const outer=ringStatus(p,rings[0]);if(outer!=="inside")return outer;for(const hole of rings.slice(1)){const h=ringStatus(p,hole);if(h==="boundary")return h;if(h==="inside")return"outside"}return"inside";}
function csvText(headers, rows) {
  const cell = value => { const s = value == null ? "" : String(value); return /[",\r\n]/.test(s) ? '"' + s.replaceAll('"','""') + '"' : s; };
  return headers.map(cell).join(",") + "\n" + rows.map(row => headers.map(h => cell(row[h])).join(",")).join("\n") + (rows.length ? "\n" : "");
}
function buildStudy(originals, hash, byteLength) {
  const specs = [
  {
    "path": "original/nutrients-2020-2022.csv",
    "id": "scdes-eighteenmile-stream-nutrients-2020-2022",
    "source_url": "https://www.waterqualitydata.us/data/Result/search?siteid=21SC60WQ_WQX-SV-233%3B21SC60WQ_WQX-SV-245%3B21SC60WQ_WQX-SV-375%3B21SC60WQ_WQX-SV-376&startDateLo=01-01-2020&startDateHi=12-31-2022&characteristicType=Nutrient&mimeType=csv&zip=no",
    "date_start": "2020-01-01",
    "date_end": "2022-12-31",
    "record_count": 182,
    "kind": "table",
    "bytes": 69221,
    "sha256": "90ca40a8697c6bc301e97e394452235ecf0ea0653024b93a2dc61f60ef1f6733"
  },
  {
    "path": "original/nutrients-2023-2025.csv",
    "id": "scdes-eighteenmile-stream-nutrients-2023-2025",
    "source_url": "https://www.waterqualitydata.us/data/Result/search?siteid=21SC60WQ_WQX-SV-233%3B21SC60WQ_WQX-SV-245%3B21SC60WQ_WQX-SV-375%3B21SC60WQ_WQX-SV-376&startDateLo=01-01-2023&startDateHi=12-31-2025&characteristicType=Nutrient&mimeType=csv&zip=no",
    "date_start": "2023-01-01",
    "date_end": "2025-12-31",
    "record_count": 407,
    "kind": "table",
    "bytes": 153018,
    "sha256": "6c36b486618b4569454ecc8e531c4b4adbd739c5f6f726f97f8e5ceafe7a7f03"
  },
  {
    "path": "original/stations-2020-2025.csv",
    "id": "scdes-seneca-nutrient-stations-2020-2025",
    "source_url": "https://www.waterqualitydata.us/data/Station/search?huc=03060101&startDateLo=01-01-2020&startDateHi=12-31-2025&characteristicType=Nutrient&mimeType=csv&zip=no",
    "record_count": 47,
    "kind": "table",
    "bytes": 14616,
    "sha256": "c27a0e7fcd486c17634c71f1f2ac8e29b7d6eaec29bf08c22c0c47d186b5708c"
  },
  {
    "path": "original/eighteenmile_nldi_whole_basin.geojson",
    "id": "usgs-eighteenmile-whole-basin",
    "source_url": "https://api.water.usgs.gov/nldi/linked-data/nwissite/USGS-02186702/basin?f=json&simplified=false&splitCatchment=false",
    "kind": "vector",
    "bytes": 13935,
    "sha256": "097050d2b09e371feb2dbcf3fe1d2fba90730086db45d4a90be514706145dc88"
  },
  {
    "path": "original/eighteenmile_nldi_reference.json",
    "id": "usgs-eighteenmile-network-reference",
    "source_url": "https://api.water.usgs.gov/nldi/linked-data/nwissite/USGS-02186702?f=json",
    "kind": "document",
    "bytes": 601,
    "sha256": "4ba9c663f4734dae1216d99564d9ae2392e7e139b5208aeaa174fa63489cb0c8"
  }
];
  const json = value => JSON.stringify(value,null,2)+"\n";
  for (const s of specs) if (byteLength(originals[s.path]) !== s.bytes || hash(originals[s.path]) !== s.sha256) throw Error("Original source hash mismatch: "+s.path);
  const parsed = specs.slice(0,2).map(s=>parseCSV(originals[s.path]));
  if (JSON.stringify(parsed[0].header)!==JSON.stringify(parsed[1].header)||parsed[0].header.length!==63) throw Error("Original result columns changed");
  const rows=parsed.flatMap(x=>x.rows);
  const ids=["SV-233","SV-245","SV-375","SV-376"];
  const stations=parseCSV(originals[specs[2].path]).rows.filter(x=>ids.includes(x.MonitoringLocationName));
  if(stations.length!==4 || stations.some(s=>s.HorizontalCoordinateReferenceSystemDatumName!=="WGS84" || s.MonitoringLocationTypeName!=="River/Stream")) throw Error("Original station membership/CRS changed");
  const activities=new Set(rows.map(r=>JSON.stringify([r.MonitoringLocationIdentifier,r.ProjectIdentifier,r.ActivityIdentifier])));
  const censored=rows.filter(r=>r.ResultDetectionConditionText!=="");
  if(rows.length!==589||activities.size!==153||censored.length!==181||rows.filter(r=>r.ResultMeasureValue!=="").length!==408) throw Error("Original cohort counts changed");
  const basin=JSON.parse(originals[specs[3].path]);
  if(basin.type!=="FeatureCollection"||basin.features.length!==1||basin.features[0].geometry.type!=="Polygon") throw Error("Original basin geometry changed");
  const memberships=stations.map(s=>({
    site_id:s.MonitoringLocationName,monitoring_location_id:s.MonitoringLocationIdentifier,
    coordinate_tokens:{longitude:s.LongitudeMeasure,latitude:s.LatitudeMeasure},
    coordinates:[Number(s.LongitudeMeasure),Number(s.LatitudeMeasure)],datum:"WGS84",source_crs:"EPSG:4326",
    station_catalog_source_id:specs[2].id,station_catalog_sha256:specs[2].sha256,
    basin_source_id:specs[3].id,basin_sha256:specs[3].sha256,
    whole_basin_membership:polygonStatus([Number(s.LongitudeMeasure),Number(s.LatitudeMeasure)],basin.features[0].geometry.coordinates),
    gauge_upstream_applicability:"not_determined_by_unsplit_basin",
    predicate:"Planar lon/lat ray crossing on original polygon, respecting exterior and hole rings; cross-product boundary tolerance 1e-12 square degrees and coordinate bounding tolerance 1e-12 degrees."
  }));
  const dates=rows.map(r=>r.ActivityStartDate).sort();
  const stationRows=stations.map(s=>({
    site_id:s.MonitoringLocationName,latitude:s.LatitudeMeasure,longitude:s.LongitudeMeasure,datum:"WGS84",epsg:4326,
    monitoring_location_id:s.MonitoringLocationIdentifier,description:s.MonitoringLocationDescriptionText,
    station_type:s.MonitoringLocationTypeName,coordinate_method:s.HorizontalCollectionMethodName,
    whole_basin_membership:memberships.find(m=>m.site_id===s.MonitoringLocationName).whole_basin_membership,
    gauge_upstream_applicability:"not_determined_by_unsplit_basin",source_url:specs[2].source_url,
    source_station_catalog_sha256:specs[2].sha256
  }));
  const notes=[
    {code:"ORIGINAL_WQP_SCOPE",context:"The original state WQP results cover four named River/Stream stations and Nutrient queries from 2020-01-01 through 2025-12-31. The two nonoverlapping query responses preserve all 63 columns, 589 result rows and 153 activities."},
    {code:"QUANTITATION",context:"181 results are Present Below Quantification Limit. Their original reported values and reported-value units are blank; original limit values, limit types and mg/L limit units remain intact. Quantified-only summaries use the other 408 original numerical values. Below-limit interval support uses the existing nonnegative concentration method without assigning a value to a censored sample."},
    {code:"SEPARATE_CONSTITUENTS",context:"Ammonia, Nitrate + Nitrite, Kjeldahl nitrogen, Phosphorus and Nitrogen remain separate original characteristics. Sample fraction, analytical method, result value type, source basis fields and effective support unit separate series. Six Nitrogen results are labeled Calculated by the publisher; no components are summed by this application."},
    {code:"WHOLE_BASIN_SCOPE",context:"All four original WGS84 station points fall inside the retained NLDI whole basin for USGS-02186702. The original request uses simplified=false and splitCatchment=false. Whole-basin membership does not establish gauge-upstream position within the same unsplit reach. The original station and basin bytes and explicit membership result are retained."},
    {code:"TEMPORAL_SCOPE",context:"Year and month filters use original sample dates. Rows retain their original local times and source time-zone labels. Sampling dates are irregular; no annual load or flow-weighted concentration is derived."},
    {code:"SEPARATE_ZERO_QUERY",context:"The prior exact USGS-02186702 Nutrient query returned a header-only response. That station-specific result remains separate from these four state stream-station queries."}
  ];
  const study={
    schema:"upstate.published-water-quality-study/v1",study_id:"scdes-eighteenmile-streams-2020-2025",
    title:"Eighteenmile Creek: four stream nutrient stations, 2020–2025",
    issuing_body:"South Carolina Department of Environmental Services, original WQP records",
    publication:"2020–2025 observations; source edition 2026-10-13",original_url:specs[0].source_url,
    observation_calendar_filters:true,observation_sources:"observation-sources.json",
    observation_scope:"Original stream observations with separate constituent, fraction, method, result-type and unit series. All four stations are inside the retained whole basin; gauge-specific upstream applicability is unassigned.",
    grab_sampling:{start:dates[0],end:dates.at(-1),frequency:"Original irregular sampling dates",total_visits:activities.size},
    content_counts:{stations:4,original_result_rows:589,original_activity_count:153,below_quantification:181,quantified:408},
    source_interpretation:{native_model_context:"Dated stream concentration context alongside separately retained native watershed model outputs.",coordinates:"Original WGS84 station coordinates; EPSG:4326. Original unsplit NLDI basin supplies whole-basin context.",temporal_support:"Original sampling dates. Calendar filters select observations; complete agency responses remain unchanged."}
  };
  const sourceIndex={schema:"upstate.observation-sources/v1",record_count:589,activity_count:153,
    sources:specs.slice(0,2).map(s=>({...s,format:"wqp-result-csv"}))};
  const summary={schema:"upstate.stream-source-summary/v1",original_result_rows:589,original_activity_count:153,quantified_count:408,censored_count:181,
    source_columns:parsed[0].header,
    stations:stationRows.map(s=>{const r=rows.filter(r=>r.MonitoringLocationIdentifier===s.monitoring_location_id);return{site_id:s.site_id,record_count:r.length,activity_count:new Set(r.map(x=>x.ActivityIdentifier)).size,whole_basin_membership:s.whole_basin_membership}}),
    characteristics:[...new Set(rows.map(r=>r.CharacteristicName))].map(parameter=>{const r=rows.filter(r=>r.CharacteristicName===parameter);return{parameter,record_count:r.length,censored_count:r.filter(x=>x.ResultDetectionConditionText!=="").length,original_result_types:[...new Set(r.map(x=>x.ResultValueTypeName))]}})
  };
  const files={...originals,
    "study.json":json(study),"source_notes.json":json(notes),
    "stations.csv":csvText(Object.keys(stationRows[0]),stationRows),
    "seasonal_summaries.csv":"site_id,stratum,depth_min_m,depth_max_m,parameter,units,mean,sd,minimum,maximum,n,source_table,source_pdf_page,statistic_basis\n",
    "observation-sources.json":json(sourceIndex),"source-summary.json":json(summary),
    "basin-membership.json":json({schema:"upstate.station-basin-membership/v1",coordinate_order:"longitude,latitude",basin_query:{simplified:false,splitCatchment:false},records:memberships}),
    "stations.geojson":json({type:"FeatureCollection",crs:{type:"name",properties:{name:"EPSG:4326"}},features:stationRows.map(s=>({type:"Feature",id:s.site_id,properties:s,geometry:{type:"Point",coordinates:[Number(s.longitude),Number(s.latitude)]}}))}),
    "README.md":"# Eighteenmile stream nutrient observations\n\nThis source cohort retains 589 original WQP result rows from four state stream stations, 2020–2025. Import the installed builtin scdes-eighteenmile-streams-2020-2025 through Published studies, select station/characteristic/year/month, and export the selected report or complete source study.\n\nThe original CSVs are unchanged. Published seasonal tables are empty because the agency query contains individual results, not a published seasonal-summary table. The source index defines nonoverlapping date intervals and exact hashes. A point-in-polygon result applies to the retained unsplit whole basin only. See source_notes.json and basin-membership.json.\n"
  };
  const entries=specs.map(s=>({id:s.id,title:s.path,uri:s.source_url,vintage:"2020–2025 / 2026-10-13 source edition",kind:s.kind,path:s.path,bytes:s.bytes,sha256:s.sha256,...(s.kind==="vector"?{source_crs:"EPSG:4326"}:{}),metadata:{original_agency_body:true,...(s.record_count!=null?{record_count:s.record_count}:{})}}));
  entries.push({id:"eighteenmile-four-stream-stations-derived",title:"Original four stream station coordinates",vintage:"2020–2025 / 2026-10-13 source edition",kind:"vector",path:"stations.geojson",source_crs:"EPSG:4326",uri:specs[2].source_url,bytes:byteLength(files["stations.geojson"]),sha256:hash(files["stations.geojson"]),metadata:{derived_from_source_id:specs[2].id}});
  files["model-sources.json"]=json({schema:"upstate.sources/v1",title:study.title,entries});
  files["study-files.json"]=json({schema:"upstate.study-file-inventory/v1",files:Object.entries(files).sort(([a],[b])=>a.localeCompare(b)).map(([path,content])=>({path,bytes:byteLength(content),sha256:hash(content)}))});
  return files;
}
const root=resolve(process.argv[2]||join(dirname(fileURLToPath(import.meta.url)),"../observations/eighteenmile_stream_nutrients_2020_2025"));
const inputs=["original/nutrients-2020-2022.csv","original/nutrients-2023-2025.csv","original/stations-2020-2025.csv","original/eighteenmile_nldi_whole_basin.geojson","original/eighteenmile_nldi_reference.json"];
const originals=Object.fromEntries(inputs.map(path=>[path,readFileSync(join(root,path),"utf8")]));
const files=buildStudy(originals,t=>createHash("sha256").update(t,"utf8").digest("hex"),t=>Buffer.byteLength(t,"utf8"));
for(const [path,content] of Object.entries(files)){const target=join(root,path);mkdirSync(dirname(target),{recursive:true});writeFileSync(target,content,"utf8");}
process.stdout.write(JSON.stringify({study_root:root,files:Object.keys(files).length,summary:JSON.parse(files["source-summary.json"])},null,2)+"\n");
