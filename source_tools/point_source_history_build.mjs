import {analyzeHistory,tableCsv,HISTORY_INPUTS,HISTORY_ROOT} from "./point_source_history.mjs";
import {renderHistory} from "./point_source_history_report.mjs";
export const HISTORY_TABLES={
 annual:"annual_coverage.csv",series:"reporting_series.csv",recent:"full_year_changes_2024_2025.csv",
 current:"same_month_changes_2025_2026.csv",cohorts:"current_upstream_full_year_cohorts.csv",
 current_cohorts:"current_upstream_same_month_cohorts.csv",source_periods:"original_selected_periods.csv"
};
export function buildHistoryFiles(inputs,inputManifest,sha256Bytes,encode){
 const result=analyzeHistory(inputs),capture=JSON.parse(inputs.capture);
 const files=Object.entries(HISTORY_TABLES).map(([key,name])=>({path:HISTORY_ROOT+"/"+name,content:tableCsv(result[key])}));
 files.push({path:HISTORY_ROOT+"/analysis.json",content:JSON.stringify(result,null,2)+"\n"});
 files.push({path:HISTORY_ROOT+"/report.html",content:renderHistory(result,inputManifest.inputs,capture)});
 const descriptor=f=>{const bytes=encode(f.content);return{path:f.path,bytes:bytes.length,sha256:sha256Bytes(bytes)};};
 const meta=Object.fromEntries(files.map(f=>[f.path,descriptor(f)]));
 const companions=Object.values(inputManifest.inputs).map(x=>({...x}));
 const names={
  annual:"Original EPA historical series-year coverage",
  series:"Original permit, reporting feature, location and parameter inventory",
  recent:"Comparable 2024-2025 full-year discharge periods",
  current:"Comparable 2025-2026 same-month discharge periods",
  cohorts:"Current upstream cohort with complete historical monthly support",
  current_cohorts:"Current upstream cohort across identical current and prior-year months",
  source_periods:"Original monitoring-period values supporting the historical analysis"
 };
 const uri="https://echo.epa.gov/tools/web-services/loading-tool";
 const entries=Object.entries(HISTORY_TABLES).map(([key,name])=>({
  id:"eighteenmile-point-history-"+key.replaceAll("_","-"),title:names[key],kind:"table",...meta[HISTORY_ROOT+"/"+name],
  uri,vintage:"2007-2026 EPA reporting history captured "+capture.captured_at,source_format:"CSV",rows:result[key].length,
  role:"POINT_SOURCE_DISCHARGE_HISTORY",measurement_support:"point_source_discharge",
  value_basis:"reported_period_amount",mass_unit:"kg",non_detect_selector:capture.scope.non_detect,
  species_basis:"Original EPA parameter code; total nitrogen, ammonia and nitrate remain separate",
  temporal_basis:key==="current"||key==="current_cohorts"?"Intersection of unique numeric calendar months in 2025 and 2026":
   key==="recent"||key==="cohorts"?"Twelve unique numeric monthly periods in each complete year":
   "Original reporting-period-ending year with explicit complete, partial, quarterly and nonnumeric support",
  route_basis:result.scope.gauge_relation_basis,companions
 }));
 for(const[name,title,format]of [["analysis.json","Complete historical point-source analysis with original row pointers","JSON"],["report.html","Interactive offline historical point-source report","HTML"]]){
  entries.push({id:"eighteenmile-point-history-"+name.split(".")[0],title,kind:"document",...meta[HISTORY_ROOT+"/"+name],uri,
   vintage:capture.captured_at,source_format:format,role:"POINT_SOURCE_DISCHARGE_HISTORY",companions});
 }
 const manifest={schema:"upstate.sources/v1",title:"Eighteenmile point-source historical support and comparisons",
  captured_at:capture.captured_at,scope:result.scope,
  notes:"Additive historical source uses original EPA period outputs and current retained routing. Full-year and same-month comparisons retain original species and reporting-feature identities. Detailed original response bodies accompany the complete 170-file source cohort.",
  entries};
 files.push({path:"point_source_history.sources.json",content:JSON.stringify(manifest,null,2)+"\n"});
 return{files,result,manifest};
}
