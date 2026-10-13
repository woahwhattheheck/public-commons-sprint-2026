import {analyze, outputFiles} from "./analysis_core.mjs";
import {renderReport} from "./report.mjs";
export const ROOT="observations/three_twenty_history_2021_2025";
export const MANIFEST="three_twenty_historical.sources.json";
const json=value=>JSON.stringify(value,null,2)+"\n";
export function assemble(inputs,authored,authoredManifest,identity){
  const files={};
  function add(path,content){
    if(!path||path.startsWith("/")||path.includes("\\")||path.split("/").some(x=>!x||x==="."||x===".."))throw Error("Unsafe application-relative path: "+path);
    if(Object.hasOwn(files,path)&&files[path]!==content)throw Error("Conflicting body: "+path);
    files[path]=content;
  }
  for(const input of inputs){const actual=identity(input.content);if(actual.bytes!==input.bytes||actual.sha256!==input.sha256)throw Error("Original source identity: "+input.path);add(input.path,input.content);}
  for(const descriptor of authoredManifest.files){const content=authored[descriptor.path];if(typeof content!=="string")throw Error("Missing authored source: "+descriptor.path);const actual=identity(content);if(actual.bytes!==descriptor.bytes||actual.sha256!==descriptor.sha256)throw Error("Authored source identity: "+descriptor.path);add(descriptor.path,content);}
  add(ROOT+"/input-manifest.json",json({schema:"upstate.original-input-manifest/v1",title:"Three and Twenty Creek historical original inputs",files:inputs.map(({content,...descriptor})=>descriptor)}));
  add(ROOT+"/authored-inputs.json",json(authoredManifest));
  const study=analyze(inputs);
  for(const[name,content]of Object.entries(outputFiles(study)))add(ROOT+"/"+name,content);
  add(ROOT+"/historical-station-comparison.html",renderReport(study));
  const nativeRoot=ROOT+"/native-study/";
  const nativeFiles=Object.keys(files).filter(path=>path.startsWith(nativeRoot)).sort().map(path=>({path:path.slice(nativeRoot.length),...identity(files[path])}));
  add(nativeRoot+"study-files.json",json({schema:"upstate.study-file-inventory/v1",study_id:"three-twenty-historical-2021-2025",files:nativeFiles}));
  const descriptors=Object.keys(files).sort().map(path=>({path,...identity(files[path])}));
  const entrySpecs=[
    ["historical-report","Historical station comparison with original-record explorer","document","observed_water_quality_report","historical-station-comparison.html"],
    ["historical-analysis","Complete historical source-bound analysis","document","observed_water_quality_analysis","historical-study.json"],
    ["historical-paired-contrasts","Compatible same-date station contrasts","table","observed_water_quality_comparison","same-date-compatible-contrasts.csv"],
    ["historical-annual-summaries","Method-stratified annual sample summaries","table","observed_water_quality_summary","annual-sample-summaries.csv"],
    ["historical-sampling-calendar","Original activity sampling calendar","table","observed_water_quality_calendar","sampling-calendar.csv"]
  ];
  const entries=entrySpecs.map(([id,title,kind,role,name])=>{const path=ROOT+"/"+name;return{id:"three-twenty-"+id,title,kind,role,path,...identity(files[path]),uri:"https://app.notion.com/p/3f8dd77231008194832bda8cdd7b6c84",vintage:"Original 2021–2025 observations; derived 2026-10-13",metadata:{source_schema:study.schema,study_id:"three-twenty-historical-2021-2025",original_result_rows:1502,original_activity_count:120,compatible_contrasts:275,comparison:"Station B minus station A; original clocks and compatibility groups retained"},companions:descriptors.filter(d=>d.path!==path)};});
  add(MANIFEST,json({schema:"upstate.sources/v1",title:"Three and Twenty Creek historical observations, 2021–2025",captured_at:"2026-10-13",scope:{selected_original_results:1502,activities:120,original_inputs:22,paired_activity_dates:24,compatible_contrasts:275},entries}));
  add(ROOT+"/family.json",json({schema:"commons.file-inventory/v1",title:"Complete historical observation source and analysis family",source_root:"opportunities/upstate_forever_2026",files:Object.keys(files).sort().map(path=>({path,...identity(files[path])}))}));
  return {files,study};
}
