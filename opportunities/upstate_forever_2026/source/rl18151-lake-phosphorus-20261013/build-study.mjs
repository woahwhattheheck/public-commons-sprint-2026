#!/usr/bin/env node
/** Build the source-bound RL-18151 study from complete original agency responses. */
import {readFileSync,writeFileSync,mkdirSync,copyFileSync,existsSync} from "node:fs";
import {resolve,dirname,join,relative} from "node:path";
import {fileURLToPath} from "node:url";
import {createHash} from "node:crypto";
import {deriveStudy} from "./analysis.mjs";
import {renderReport} from "./render-report.mjs";
const root=resolve(process.argv[2]||"."),here=dirname(fileURLToPath(import.meta.url));
const sha=raw=>createHash("sha256").update(raw).digest("hex");
const utf8=raw=>new TextDecoder("utf-8",{fatal:true}).decode(raw);
const json=value=>JSON.stringify(value,null,2)+"\n";
const canonical=path=>{
  if(typeof path!=="string"||!path||path.includes("\\")||path.startsWith("/")||path.split("/").some(part=>!part||part==="."||part===".."))
    throw Error("Source member must use a canonical relative path");
  return path;
};
const read=path=>readFileSync(join(root,canonical(path)));
const save=(path,body)=>{const target=join(root,canonical(path));mkdirSync(dirname(target),{recursive:true});writeFileSync(target,body,"utf8");};
const descriptor=path=>{const raw=read(path);return {path,bytes:raw.length,sha256:sha(raw)};};
const manifest=JSON.parse(utf8(read("capture-manifest.json")));
const sources={},seen=new Set();
for(const item of manifest.originals||[]){
  canonical(item.path);if(seen.has(item.path))throw Error("Repeated original member");seen.add(item.path);
  const raw=read(item.path);
  if(raw.length!==item.bytes||sha(raw)!==item.sha256)throw Error("Original response changed: "+item.path);
  sources[item.path]=utf8(raw);
}
if(sha(read("acquisition-plan.json"))!==manifest.plan_sha256)throw Error("Original acquisition plan changed");
const result=deriveStudy(sources,manifest);
for(const [path,body]of Object.entries(result.outputs))save(path,body);
const datum=result.summary.station.HorizontalCoordinateReferenceSystemDatumName;
const epsg=datum==="WGS84"?4326:datum==="NAD83"?4269:null;
if(!epsg)throw Error("Original station datum requires an explicit transform before geographic registration");
save("derived/station.geojson",json({type:"FeatureCollection",crs:{type:"name",properties:{name:"EPSG:"+epsg}},
  features:[{type:"Feature",id:result.summary.station_id,
    geometry:{type:"Point",coordinates:[result.summary.station.longitude,result.summary.station.latitude]},
    properties:{...result.summary.station,original_station_source:"original/station.csv",
      original_station_sha256:manifest.originals.find(item=>item.path==="original/station.csv").sha256}}]}));
const codeFiles=["analysis.mjs","render-report.mjs","build-study.mjs","import_rl18151.py","README.md"];
for(const name of codeFiles){
  const source=join(here,name),target=join(root,name);
  if(!existsSync(source))throw Error("Full scientific source lacks "+name);
  if(source!==target){
    const raw=readFileSync(source);
    if(existsSync(target)&&sha(readFileSync(target))!==sha(raw))throw Error("Receiving has a different compiler edition: "+name);
    if(!existsSync(target))copyFileSync(source,target);
  }
}
const captureCompanions=["SOURCE_CAPTURE.md","original-join-census.json","supplemental-requests.json"].filter(path=>existsSync(join(root,path)));
const originalPaths=manifest.originals.map(item=>item.path);
const dataPaths=[...Object.keys(result.outputs),"derived/station.geojson"];
const sourcePaths=[...originalPaths,"capture-manifest.json","acquisition-plan.json","capture_rl18151.py",...codeFiles,...dataPaths,...captureCompanions].sort();
save("report.html",renderReport(result,sourcePaths));
const members=[...sourcePaths,"report.html"].sort().map(descriptor);
const phosphorus=result.records.filter(row=>/phosphor/i.test(row.characteristic));
const phosphorusGroups=Object.fromEntries([...new Set(phosphorus.map(row=>row.characteristic))].sort().map(name=>[name,phosphorus.filter(row=>row.characteristic===name).length]));
const annualRows=result.cohorts.filter(row=>/phosphor/i.test(row.characteristic)).map(row=>[
 row.year,row.characteristic,row.fraction||"(blank)",row.unit||"(blank)",[row.interval_unit,row.method_specification].filter(Boolean).join(" ")+" / "+row.interval_unit_basis,row.depth_value?row.depth_value+" "+row.depth_unit:"(not supplied)",
 [row.method_context,row.method_id,row.method_name].filter(Boolean).join(":"),String(row.records),String(row.numeric_records),String(row.left_censored_records),
 row.numeric_median===null?"—":String(row.numeric_median)]);
const recipe={
 schema:"upstate.observed-report/v1",title:"RL-18151 original Lake Keowee observations, 2018–2026",
 station_id:result.summary.station_id,inputs:members,
 source_links:["report.html","derived/study-summary.json","derived/observed-records.csv","derived/annual-cohorts.csv",
               "capture-manifest.json","acquisition-plan.json",...originalPaths,"README.md"],
 sections:[
  ["RL-18151 original station and assessment context",[
   "Original Lake Keowee sampling at "+result.summary.station.latitude+", "+result.summary.station.longitude+" ("+datum+"). The retained 2024 source lists total phosphorus at station RL-18151, HUC12 030601010204, source page 61 / record 5d50e961f2d6ea86619791dc. This assessment edition remains separate from the dates of individual measurements.",
   "Requested period: "+manifest.selected_start+" through "+manifest.selected_end+". Returned results span "+result.summary.first_date+" through "+result.summary.last_date+".",
   {kind:"table",columns:["Original scope","Count"],rows:[
    ["Agency responses",String(result.summary.source_response_count)],["Result records",String(result.summary.records)],
    ["Native ResultIdentifiers",String(result.summary.result_identifiers)],["Original activities",String(result.summary.activities)],["Sampling dates",String(result.summary.sampling_dates)],
    ...Object.entries(phosphorusGroups).map(([name,n])=>[name+" result records",String(n)])]},
   {kind:"links",items:[{title:"Offline original-record explorer and exact source inspectors",path:"report.html"},
                        {title:"Original station coordinates and source metadata",path:"original/station.csv"}]}
  ]],
  ["RL-18151 phosphorus source cohorts",[
   "Rows retain exact fraction, original and interval units, chemical basis from the original narrow MethodSpecificationName, medium, sampling depth, analytical method and result basis. Phosphorus is as P, ammonia is as NH3, and nitrogen-as-N source records remain separate. A blank original result value and unit can retain a separately typed, explicitly published quantitation-limit bound. Reported numeric summaries describe only the numeric subset; censored records retain their separate published bounds. No unsampled day, annual load or water flux is reconstructed.",
   {kind:"table",columns:["Year","Characteristic","Fraction","Original unit","Interval unit / basis","Depth","Method","Records","Numeric","Left-censored","Numeric median"],rows:annualRows},
   {kind:"links",items:[{title:"Complete annual cohorts and exact original-row membership",path:"derived/annual-cohorts.json"},
                        {title:"All original result fields, qualifiers and detection limits",path:"derived/observed-records.json"}]}
  ]],
  ["RL-18151 receiving and interpretation",[
   result.summary.censor_method,result.summary.temporal_comparability,result.summary.interpretation,
   result.summary.identity_method,
   {kind:"links",items:[{title:"Complete acquisition requests and assessment-source identity",path:"acquisition-plan.json"},
                        {title:"Per-response retrieval metadata and exact content identities",path:"capture-manifest.json"},
                        {title:"Native receiving and reproducible compilation guide",path:"README.md"}]}
  ]]
 ]
};
save("observed-report.json",json(recipe));
const closure=[...members,descriptor("observed-report.json")];
const entry=(id,title,kind,path,role,uri)=>({
 id,title,kind,path,role,uri,vintage:"Original agency responses retained "+manifest.originals.map(item=>item.retrieved_at).sort().at(-1),
 ...descriptor(path),companions:closure.filter(item=>item.path!==path),
 station_id:result.summary.station_id,source_operation:manifest.operation
});
const entries=[entry("rl18151-phosphorus-observed-report-2018-20261013",
 "RL-18151 original phosphorus and lake context, 2018–2026","document","observed-report.json","OBSERVED_CONTEXT",
 "https://www.waterqualitydata.us/provider/STORET/21SC60WQ_WQX/21SC60WQ_WQX-RL-18151/"),
 entry("rl18151-original-station","RL-18151 original agency station coordinates","vector","derived/station.geojson","OBSERVATION_STATION",
 manifest.originals.find(item=>item.path==="original/station.csv").uri)];
for(const group of ["nutrient","physical","microbiological"]){
 entries.push(entry("rl18151-"+group+"-observations-2018-20261013",
  "RL-18151 original "+group+" context","table","derived/observations-"+group+".csv","OBSERVATION_CONTEXT",
  manifest.originals.find(item=>item.path==="original/"+group+"-results.csv").uri));
}
save("sources.json",json({schema:"upstate.sources/v1",title:recipe.title,station_id:result.summary.station_id,entries}));
save("study-files.json",json({schema:"upstate.source-members/v1",operation:manifest.operation,
 members:[...closure,descriptor("sources.json")].sort((a,b)=>a.path.localeCompare(b.path))}));
process.stdout.write(json({records:result.summary.records,activities:result.summary.activities,
 output:root,manifest:"sources.json",recipe:"observed-report.json",members:closure.length,phosphorus:phosphorusGroups}));
