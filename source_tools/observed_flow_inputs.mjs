/* Join retained USGS JSON/RDB editions for the maintained offline flow explorer. */
const CFS_M3_DAY=0.028316846592*86400;
const finite=v=>v!==""&&v!==null&&v!==undefined&&Number.isFinite(Number(v));
const flags=value=>new Set(String(value||"").split(/[|;,:\s]+/).filter(Boolean));
const stableSum=values=>{let s=0,c=0;for(const x of values){const y=x-c,t=s+y;c=(t-s)-y;s=t;}return s;};
const unique=(values,label)=>{const ids=new Set();for(const id of values){if(ids.has(id))throw Error("Duplicate "+label+": "+id);ids.add(id);}};
export function combineObservedFlow({annual,daily,dates,assessment,inputs,extensionAnnual,extensionDaily,extensionReferences,extensionCapture,sourceBindings=[]}){
 const root="source/hydrology-huc05-07-20261013/";
 const oldSites=new Set(annual.map(r=>r.site)),newSites=new Set(extensionAnnual.map(r=>r.site));
 for(const site of newSites)if(oldSites.has(site))throw Error("Gauge appears in both retained editions: "+site);
 const added=extensionDaily.map(r=>{
  if(!newSites.has(r.site_no)||!/^original\/[A-Za-z0-9_.-]+\.tsv$/.test(r.source_path)||!Number.isInteger(Number(r.source_line))||Number(r.source_line)<1)throw Error("Invalid original RDB row identity");
  if(finite(r.value_cfs)&&(!finite(r.reported_value)||Number(r.value_cfs)!==Number(r.reported_value)))throw Error("Original reported flow differs from normalized value");
  return {site:r.site_no,date:r.date,reported_mean_cfs:r.reported_value,qualifiers:r.qualifiers,source_id:"rdb:"+r.source_path,source_values_index:"",source_record_index:"",source_line:r.source_line,source_method_id:r.ts_id};
 });
 const combinedAnnual=[...annual,...extensionAnnual].sort((a,b)=>a.site.localeCompare(b.site)||a.period_start.localeCompare(b.period_start));
 const combinedDaily=[...daily,...added].sort((a,b)=>a.site.localeCompare(b.site)||a.date.localeCompare(b.date));
 unique(combinedAnnual.map(r=>r.site+":"+r.period_start),"annual gauge period");
 unique(combinedDaily.map(r=>r.site+":"+r.date),"daily gauge record");
 const originals=new Map(extensionCapture.originals.map(r=>[r.path,r]));
 for(const row of added)if(!originals.has(row.source_id.slice(4)))throw Error("Daily row has no original response");
 const stations=extensionReferences.map(r=>{
  const rows=extensionAnnual.filter(a=>a.site===r.site),target=rows.find(a=>a.period_start==="2023-01-01"),refs=String(r.reference_years).split("|").filter(Boolean);
  if(!target)throw Error("Reference context lacks target year");
  const complete=rows.filter(a=>Number(a.valid_days)===Number(a.expected_days)&&Number(a.approved_days)===Number(a.expected_days));
  const isComplete=r.target_complete_approved==="true";
  return {site:r.site,site_name:r.site_name,year:2023,valid_days:Number(target.valid_days),expected_days:Number(target.expected_days),complete_year:Number(target.valid_days)===Number(target.expected_days),complete_approved_target:isComplete,complete_reference_years:refs,complete_year_count:complete.length,observed_mean_cfs:finite(target.mean_cfs)?Number(target.mean_cfs):null,complete_year_runoff_mm:finite(target.complete_period_runoff_mm)?Number(target.complete_period_runoff_mm):null,reference_median_annual_mean_cfs:finite(r.median_reference_annual_mean_cfs)?Number(r.median_reference_annual_mean_cfs):null,mean_ratio_to_other_complete_years:finite(r.complete_approved_2023_to_reference_ratio)?Number(r.complete_approved_2023_to_reference_ratio):null,ascending_mean_rank:isComplete?1+complete.filter(a=>Number(a.mean_cfs)<Number(target.mean_cfs)).length:null,approved_days:Number(target.approved_days),provisional_days:Number(target.provisional_days),estimated_days:Number(target.estimated_days),revised_days:Number(target.revised_days),reference_basis:r.comparison_basis,reference_quality:rows.filter(a=>refs.includes(a.period_start.slice(0,4))).map(a=>({year:a.period_start.slice(0,4),approved_days:Number(a.approved_days),provisional_days:Number(a.provisional_days),estimated_days:Number(a.estimated_days),revised_days:Number(a.revised_days)}))};
 });
 const newAssessment={...assessment,station_context:[...assessment.station_context.map(r=>({...r,reference_basis:"Median of other complete calendar-year daily means; original quality flags remain visible"})),...stations].sort((a,b)=>a.site.localeCompare(b.site)),input_sources:[...assessment.input_sources,...sourceBindings]};
 const newInputs={...inputs,originals:[...inputs.originals.map(r=>({...r,href:"../observed_hydrology_20261013/"+(r.path||r.local_path)})),...extensionCapture.originals.map(r=>({...r,id:"rdb:"+r.path,href:"../../"+root+r.path,format:"USGS RDB",record_position:"one-based original text line"}))]};
 const byYear=new Map();for(const r of combinedDaily){const key=r.site+":"+r.date.slice(0,4);if(!byYear.has(key))byYear.set(key,[]);byYear.get(key).push(r);}
 const quality=combinedAnnual.map(a=>{
  const rows=byYear.get(a.site+":"+a.period_start.slice(0,4))||[],numeric=rows.filter(r=>finite(r.reported_mean_cfs)),total=stableSum(numeric.map(r=>Number(r.reported_mean_cfs))),estimated=numeric.filter(r=>flags(r.qualifiers).has("e")),provisional=numeric.filter(r=>flags(r.qualifiers).has("P")),approved=numeric.filter(r=>flags(r.qualifiers).has("A")),high=finite(a.p95_daily_cfs)?numeric.filter(r=>Number(r.reported_mean_cfs)>=Number(a.p95_daily_cfs)):[];
  if(numeric.length!==Number(a.valid_days))throw Error("Original daily/annual coverage differs for "+a.site+" "+a.period_start);
  if(numeric.length&&Math.abs(total/numeric.length-Number(a.mean_cfs))>1e-10*Math.max(1,Math.abs(Number(a.mean_cfs))))throw Error("Original daily/annual flow differs");
  const part=xs=>total>0?stableSum(xs.map(r=>Number(r.reported_mean_cfs)))/total:null;
  return {site:a.site,site_name:a.site_name,year:Number(a.period_start.slice(0,4)),record_days:rows.length,numeric_days:numeric.length,expected_days:Number(a.expected_days),nonnumeric_days:rows.length-numeric.length,absent_days:Number(a.expected_days)-rows.length,complete_observed_period:numeric.length===Number(a.expected_days),fully_approved_complete_period:approved.length===Number(a.expected_days),estimated_days:estimated.length,provisional_days:provisional.length,approved_days:approved.length,observed_volume_m3:numeric.length?total*CFS_M3_DAY:null,complete_period_volume_m3:numeric.length===Number(a.expected_days)?total*CFS_M3_DAY:null,estimated_fraction_of_observed_volume:part(estimated),provisional_fraction_of_observed_volume:part(provisional),p95_daily_cfs:finite(a.p95_daily_cfs)?Number(a.p95_daily_cfs):null,days_at_or_above_period_p95:high.length,fraction_of_observed_volume_at_or_above_period_p95:part(high)};
 });
 const summary={schema:"upstate.combined-observed-flow/v2",gauge_count:new Set(combinedAnnual.map(r=>r.site)).size,annual_periods:combinedAnnual.length,retained_daily_records:combinedDaily.length,numeric_daily_records:combinedDaily.filter(r=>finite(r.reported_mean_cfs)).length,quality,reference_context:newAssessment.station_context,input_sources:newAssessment.input_sources,method:"Daily original values are retained verbatim. Water-volume fractions sum original numeric daily mean discharge. Estimated and approved flags can coexist. A nonnumeric agency value remains in the source inspector and CSV; it creates a plot gap. Annual volumes require every calendar day to be numeric. The added 13-gauge reference uses only fully approved complete years, as specified by its retained source; the original 16-gauge reference preserves its original complete-year rule."};
 return {annual:combinedAnnual,daily:combinedDaily,samples:dates,assessment:newAssessment,inputs:newInputs,quality,summary};
}
