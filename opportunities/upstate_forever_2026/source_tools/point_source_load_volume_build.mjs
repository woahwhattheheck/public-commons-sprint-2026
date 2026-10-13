import {buildDriverAnalysis,DRIVER_ROOT} from "./point_source_load_volume.mjs";
import {renderDrivers} from "./point_source_load_volume_report.mjs";
export const DRIVER_TABLES={summaries:"series_windows.csv",monthly:"paired_months.csv",cohorts:"upstream_cohorts.csv",coverage:"coverage.csv"};
export function driverCsv(rows){
 if(!rows.length)return "";
 const columns=[...new Set(rows.flatMap(r=>Object.keys(r)))];
 const quote=v=>{const s=v==null?"":typeof v==="object"?JSON.stringify(v):String(v);return /[",\r\n]/.test(s)?'"'+s.replace(/"/g,'""')+'"':s;};
 return columns.join(",")+"\n"+rows.map(r=>columns.map(k=>quote(r[k])).join(",")).join("\n")+"\n";
}
export function buildDriverFiles(inputs,inputManifest,sha256Bytes,encode){
 const result=buildDriverAnalysis(inputs);
 const files=Object.entries(DRIVER_TABLES).map(([key,name])=>({path:DRIVER_ROOT+"/"+name,content:driverCsv(result[key])}));
 files.push({path:DRIVER_ROOT+"/analysis.json",content:JSON.stringify(result,null,2)+"\n"});
 files.push({path:DRIVER_ROOT+"/report.html",content:renderDrivers(result,inputManifest)});
 const descriptor=f=>{const bytes=encode(f.content);return{path:f.path,bytes:bytes.length,sha256:sha256Bytes(bytes)};};
 const meta=Object.fromEntries(files.map(f=>[f.path,descriptor(f)]));
 const companions=Object.values(inputManifest.inputs).map(x=>({...x}));
 const uri="https://echo.epa.gov/tools/web-services/loading-tool";
 const titles={summaries:"Reported load and volume: exact original series and comparison windows",
  monthly:"Original paired monthly discharge loads, volumes and symmetric accounting",
  cohorts:"Currently upstream phosphorus and suspended-solids accounting",
  coverage:"Original series/windows without comparable monthly support"};
 const entries=Object.entries(DRIVER_TABLES).map(([key,name])=>({
  id:"eighteenmile-load-volume-"+key,title:titles[key],kind:"table",...meta[DRIVER_ROOT+"/"+name],
  uri,vintage:"EPA original periods captured "+result.source_capture,source_format:"CSV",rows:result[key].length,
  role:"POINT_SOURCE_DISCHARGE_LOAD_VOLUME",measurement_support:"point_source_discharge",value_basis:"reported_period_amount",
  units:result.units,temporal_basis:"Exact original full-year monthly pairs and retained 2025-2026 common calendar months",
  non_detect_selector:"ZERO",species_basis:"Original EPA parameter code retained per series",
  accounting_basis:"Sum of separate symmetric monthly identities; whole-window alternative retained separately",
  companions
 }));
 for(const[name,title,format]of [["analysis.json","Complete original reported load and volume analysis","JSON"],
  ["report.html","Offline reported load and wastewater volume report","HTML"]]){
  entries.push({id:"eighteenmile-load-volume-"+name.split(".")[0],title,kind:"document",...meta[DRIVER_ROOT+"/"+name],
   uri,vintage:result.source_capture,source_format:format,role:"POINT_SOURCE_DISCHARGE_LOAD_VOLUME",
   measurement_support:"point_source_discharge",companions});
 }
 const manifest={schema:"upstate.sources/v1",title:"Eighteenmile reported load and wastewater volume",
  captured_at:result.source_capture,
  scope:{permits:[...new Set(result.summaries.map(r=>r.permit_id))],source_windows:["2024-2025 full-year","2025-2026 identical calendar months"],
   relationship:"Retained current outfall-to-gauge mapping",counts:result.counts,units:result.units},
  notes:"Original EPA period loads and volumes retain the same permit, reporting feature, location and parameter. Symmetric paired-month components describe the reported mass/volume identity. Original concentrations, measurement types, qualifiers and source pointers remain separate fields.",
  entries};
 files.push({path:"point_source_load_volume.sources.json",content:JSON.stringify(manifest,null,2)+"\n"});
 return{files,result,manifest};
}
