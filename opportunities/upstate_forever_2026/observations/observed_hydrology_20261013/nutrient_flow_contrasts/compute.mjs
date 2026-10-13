/** Source-bound descriptive nutrient/flow contrasts; pure computation, no I/O. */
export function parseCsv(text) {
 const rows=[];let row=[],cell="",quoted=false;
 for(let i=0;i<text.length;i++){const c=text[i];
  if(quoted){if(c==='"'&&text[i+1]==='"'){cell+='"';i++;}else if(c==='"')quoted=false;else cell+=c;}
  else if(c==='"')quoted=true;else if(c===','){row.push(cell);cell="";}
  else if(c==='\n'){row.push(cell.replace(/\r$/,""));rows.push(row);row=[];cell="";}else cell+=c;
 }if(quoted)throw Error("Unterminated CSV field");if(cell||row.length){row.push(cell.replace(/\r$/,""));rows.push(row);}
 const header=rows.shift();if(!header||new Set(header).size!==header.length)throw Error("Missing or duplicate CSV headers");
 return rows.filter(r=>r.some(v=>v!=="")).map(r=>{if(r.length!==header.length)throw Error("CSV row width differs");return Object.fromEntries(header.map((h,i)=>[h,r[i]]));});
}
export function csv(rows) {
 if(!rows.length)return "";const keys=Object.keys(rows[0]);
 const cell=v=>'"'+String(v===undefined||v===null?"":typeof v==="object"?JSON.stringify(v):v).replaceAll('"','""')+'"';
 return keys.map(cell).join(",")+"\n"+rows.map(r=>keys.map(k=>cell(r[k])).join(",")).join("\n")+"\n";
}
function number(value,label){if(value===null||value===undefined||String(value).trim()===""||!Number.isFinite(Number(value)))throw Error("Missing finite "+label);return Number(value);}
function close(a,b,label){if(Math.abs(a-b)>1e-10*Math.max(1,Math.abs(a),Math.abs(b)))throw Error("Source mismatch: "+label);}
function mean(a){return a.reduce((x,y)=>x+y,0)/a.length;}
function quantile(sorted,p){const x=(sorted.length-1)*p,i=Math.floor(x);return sorted[i]+(sorted[Math.min(i+1,sorted.length-1)]-sorted[i])*(x-i);}
function compare(a,b){return a<b?-1:a>b?1:0;}
export function compute(files) {
 const nutrient=parseCsv(files["derived/nutrient_results_with_flow.csv"]);
 const totalN=parseCsv(files["derived/nutrient_activity_total_nitrogen.csv"]);
 const flow=parseCsv(files["derived/daily_flow.csv"]).filter(r=>r.site==="02186702"&&r.date.startsWith("2023-"));
 if(nutrient.length!==96||totalN.length!==24||flow.length!==365)throw Error("Select the retained 2023 96-result, 24-TN, 365-flow edition");
 const byDate=new Map();for(const r of flow){if(byDate.has(r.date)||r.qualifiers!=="A")throw Error("Gauge days duplicate or not approved");byDate.set(r.date,r);}
 const qValues=flow.map(r=>number(r.reported_mean_cfs,"gauge flow")).sort((a,b)=>a-b);
 const thresholds={p25:quantile(qValues,.25),p50:quantile(qValues,.5),p75:quantile(qValues,.75),p95:quantile(qValues,.95)};
 const band=q=>q<=thresholds.p25?"Q1":q<=thresholds.p50?"Q2":q<=thresholds.p75?"Q3":"Q4";
 function flowContext(r) {
  const f=byDate.get(r.sample_date);if(!f)throw Error("Sample has no original daily flow");
  close(number(r.same_date_mean_cfs,"sample flow"),number(f.reported_mean_cfs,"gauge flow"),"same-date flow");
  if(r.flow_source_id!==f.source_id||r.flow_source_record_index!==f.source_record_index)throw Error("Gauge lineage differs");
  const q=number(f.reported_mean_cfs,"flow");
  return {gauge_id:"USGS-02186702",same_date_mean_cfs:q,flow_qualifiers:f.qualifiers,
   flow_source_id:f.source_id,flow_source_record_index:f.source_record_index,
   flow_quartile:band(q),at_or_above_p95:q>=thresholds.p95,
   flow_midrank_percentile:100*(qValues.filter(x=>x<q).length+.5*qValues.filter(x=>x===q).length)/qValues.length};
 }
 const originals=new Map(),activity=new Map(),dated=[];
 for(const r of nutrient){
  if(r.project_id!=="SWS-2023"||r.activity_type!=="Sample-Routine"||r.sample_fraction!=="Unfiltered")throw Error("Unexpected routine nutrient cohort");
  const key=r.source_id+":"+r.source_record_index;if(originals.has(key))throw Error("Duplicate original result");
  let lower,upper,status;
  if(r.quantified_mg_l!==""){
   if(r.reported_unit!=="mg/L"||r.detection_condition)throw Error("Unexpected qualified numeric source");
   lower=upper=number(r.quantified_mg_l,"concentration");status="quantified";close(lower,number(r.reported_concentration,"original value"),"original concentration");
  }else{
   if(r.detection_condition!=="Present Below Quantification Limit"||r.reported_limit_unit!=="mg/L"||!/^Lower /.test(r.limit_type))throw Error("Unsupported source censor condition");
   lower=0;upper=number(r.reported_limit,"original limit");status="below_limit";
  }
  if(lower<0||upper<lower)throw Error("Invalid concentration interval");
  close(lower,number(r.censor_lower_mg_l,"lower"),"original lower bound");close(upper,number(r.censor_upper_mg_l,"upper"),"original upper bound");
  originals.set(key,{r,lower,upper,status});
  const activityKey=[r.monitoring_location_id,r.activity_id,r.sample_date,r.sample_fraction].join("|");
  if(!activity.has(activityKey))activity.set(activityKey,[]);activity.get(activityKey).push(r);
  dated.push({station_id:r.monitoring_location_id,activity_id:r.activity_id,project_id:r.project_id,sample_date:r.sample_date,
   sample_time:r.source_sample_time,sample_timezone:r.source_time_zone,sample_fraction:r.sample_fraction,
   parameter:r.characteristic,unit:"mg/L",quantified_value_mg_l:r.quantified_mg_l,lower_mg_l:lower,upper_mg_l:upper,
   interval_status:status,source_strict_relation:status==="below_limit"?"<":"=",
   original_detection_condition:r.detection_condition,original_limit_type:r.limit_type,original_limit:r.reported_limit,
   original_limit_unit:r.reported_limit_unit,source_result_ids:[key],source_record:r,...flowContext(r)});
 }
 for(const r of totalN) {
  const tkn=originals.get(r.tkn_source_id+":"+r.tkn_source_record_index),nox=originals.get(r.nox_source_id+":"+r.nox_source_record_index);
  if(!tkn||!nox||tkn.r.characteristic!=="Kjeldahl nitrogen"||nox.r.characteristic!=="Nitrate + Nitrite")throw Error("TN original components differ");
  for(const k of ["monitoring_location_id","activity_id","sample_date","sample_fraction","project_id"])
   if(tkn.r[k]!==nox.r[k]||tkn.r[k]!==r[k])throw Error("TN components not same activity");
  for(const k of ["source_sample_time","source_time_zone"])if(tkn.r[k]!==nox.r[k])throw Error("TN component clocks differ");
  const lower=tkn.lower+nox.lower,upper=tkn.upper+nox.upper;
  close(lower,number(r.tn_censor_lower_mg_l,"TN lower"),"TN lower sum");close(upper,number(r.tn_censor_upper_mg_l,"TN upper"),"TN upper sum");
  if(r.quantified_tn_mg_l!==""){if(tkn.status!=="quantified"||nox.status!=="quantified")throw Error("Censored TN marked numeric");close(number(r.quantified_tn_mg_l,"TN"),lower,"quantified TN");}
  dated.push({station_id:r.monitoring_location_id,activity_id:r.activity_id,project_id:r.project_id,sample_date:r.sample_date,
   sample_time:tkn.r.source_sample_time,sample_timezone:tkn.r.source_time_zone,sample_fraction:r.sample_fraction,
   parameter:"Total nitrogen (TKN + NOx)",unit:"mg/L",quantified_value_mg_l:r.quantified_tn_mg_l,lower_mg_l:lower,upper_mg_l:upper,
   interval_status:lower===upper?"quantified":"component_sum_interval",
   source_strict_relation:lower===upper?"=":"Sum of nonnegative component enclosures; strict original relations retained",
   original_detection_condition:[tkn.r.detection_condition,nox.r.detection_condition],
   original_limit_type:[tkn.r.limit_type,nox.r.limit_type],original_limit:[tkn.r.reported_limit,nox.r.reported_limit],
   original_limit_unit:[tkn.r.reported_limit_unit,nox.r.reported_limit_unit],
   source_result_ids:[r.tkn_source_id+":"+r.tkn_source_record_index,r.nox_source_id+":"+r.nox_source_record_index],
   source_record:r,...flowContext(r)});
 }
 dated.sort((a,b)=>compare(a.station_id,b.station_id)||compare(a.sample_date,b.sample_date)||compare(a.parameter,b.parameter));
 const calendar=[...activity].map(([key,a])=>{
  if(a.length!==4||new Set(a.map(r=>r.characteristic)).size!==4)throw Error("Incomplete routine activity");
  const r=a[0];if(a.some(x=>x.source_sample_time!==r.source_sample_time||x.source_time_zone!==r.source_time_zone))throw Error("Activity clocks differ");
  return {station_id:r.monitoring_location_id,activity_id:r.activity_id,project_id:r.project_id,sample_date:r.sample_date,
   sample_time:r.source_sample_time,sample_timezone:r.source_time_zone,original_results:a.length,
   source_result_ids:a.map(x=>x.source_id+":"+x.source_record_index),...flowContext(r)};
 }).sort((a,b)=>compare(a.station_id,b.station_id)||compare(a.sample_date,b.sample_date));
 const groups=new Map();
 for(const r of dated)for(const group of ["ALL",r.flow_quartile,r.at_or_above_p95?"AT_OR_ABOVE_P95":"BELOW_P95"]){
  const key=[r.station_id,r.parameter,group].join("|");if(!groups.has(key))groups.set(key,[]);groups.get(key).push(r);
 }
 const summaries=[...groups].map(([key,a])=>({
  station_id:a[0].station_id,parameter:a[0].parameter,unit:"mg/L",flow_group:key.split("|").at(-1),
  visit_count:a.length,quantified_count:a.filter(r=>r.interval_status==="quantified").length,
  censored_interval_count:a.filter(r=>r.interval_status!=="quantified").length,
  mean_lower_mg_l:mean(a.map(r=>r.lower_mg_l)),mean_upper_mg_l:mean(a.map(r=>r.upper_mg_l)),
  sample_flow_mean_cfs:mean(a.map(r=>r.same_date_mean_cfs)),sample_flow_min_cfs:Math.min(...a.map(r=>r.same_date_mean_cfs)),
  sample_flow_max_cfs:Math.max(...a.map(r=>r.same_date_mean_cfs)),
  sample_dates:a.map(r=>r.sample_date),activity_ids:a.map(r=>r.activity_id),source_result_ids:a.flatMap(r=>r.source_result_ids)
 })).sort((a,b)=>compare(a.station_id,b.station_id)||compare(a.parameter,b.parameter)||compare(a.flow_group,b.flow_group));
 const contrasts=[];
 for(const a of summaries.filter(r=>r.station_id.endsWith("-SV-268"))){
  const b=summaries.find(r=>r.station_id.endsWith("-SV-374")&&r.parameter===a.parameter&&r.flow_group===a.flow_group);if(!b)continue;
  contrasts.push({parameter:a.parameter,unit:"mg/L",flow_group:a.flow_group,
   station_a:a.station_id,station_b:b.station_id,visits_a:a.visit_count,visits_b:b.visit_count,
   mean_a_lower_mg_l:a.mean_lower_mg_l,mean_a_upper_mg_l:a.mean_upper_mg_l,
   mean_b_lower_mg_l:b.mean_lower_mg_l,mean_b_upper_mg_l:b.mean_upper_mg_l,
   difference_a_minus_b_lower_mg_l:a.mean_lower_mg_l-b.mean_upper_mg_l,
   difference_a_minus_b_upper_mg_l:a.mean_upper_mg_l-b.mean_lower_mg_l,
   intervals_separated_a_above_b:a.mean_lower_mg_l>b.mean_upper_mg_l,
   sample_dates_a:a.sample_dates,sample_dates_b:b.sample_dates,
   pairing:"Descriptive unmatched visit groups; common annual gauge-flow strata"});
 }
 const sameDate=[];
 for(const a of dated.filter(r=>r.station_id.endsWith("-SV-268"))){
  const matches=dated.filter(r=>r.station_id.endsWith("-SV-374")&&r.sample_date===a.sample_date&&r.parameter===a.parameter);
  for(const b of matches)sameDate.push({sample_date:a.sample_date,parameter:a.parameter,unit:"mg/L",
   gauge_mean_cfs:a.same_date_mean_cfs,station_a:a.station_id,station_b:b.station_id,
   activity_a:a.activity_id,activity_b:b.activity_id,time_a:a.sample_time,time_b:b.sample_time,
   timezone_a:a.sample_timezone,timezone_b:b.sample_timezone,
   lower_a_mg_l:a.lower_mg_l,upper_a_mg_l:a.upper_mg_l,lower_b_mg_l:b.lower_mg_l,upper_b_mg_l:b.upper_mg_l,
   difference_lower_mg_l:a.lower_mg_l-b.upper_mg_l,difference_upper_mg_l:a.upper_mg_l-b.lower_mg_l,
   source_result_ids_a:a.source_result_ids,source_result_ids_b:b.source_result_ids});
 }
 const event=[];
 for(const e of dated.filter(r=>r.station_id.endsWith("-SV-268")&&r.sample_date==="2023-06-12")){
  const controls=dated.filter(r=>r.station_id===e.station_id&&r.parameter===e.parameter&&!r.at_or_above_p95);
  const lo=mean(controls.map(r=>r.lower_mg_l)),hi=mean(controls.map(r=>r.upper_mg_l));
  event.push({station_id:e.station_id,parameter:e.parameter,unit:"mg/L",event_date:e.sample_date,event_activity:e.activity_id,
   event_mean_cfs:e.same_date_mean_cfs,event_flow_midrank_percentile:e.flow_midrank_percentile,
   event_lower_mg_l:e.lower_mg_l,event_upper_mg_l:e.upper_mg_l,comparison_visits:controls.length,
   comparison_selection:"Same station, same constituent, routine visits below annual gauge p95",
   comparison_mean_lower_mg_l:lo,comparison_mean_upper_mg_l:hi,
   event_minus_comparison_lower_mg_l:e.lower_mg_l-hi,event_minus_comparison_upper_mg_l:e.upper_mg_l-lo,
   ratio_lower:hi>0?e.lower_mg_l/hi:null,ratio_upper:lo>0?e.upper_mg_l/lo:null,
   event_source_result_ids:e.source_result_ids,comparison_activity_ids:controls.map(r=>r.activity_id)});
 }
 const methods={schema:"upstate.nutrient-flow-contrasts/v1",cohort:"2023 SWS-2023 Sample-Routine, two lake sites, original unfiltered results",
  original_results:96,original_activities:24,same_activity_tn_rows:24,comparison_value_rows:120,
  gauge_id:"USGS-02186702",gauge_days:365,approved_days:365,thresholds_cfs:thresholds,
  quantile_method:"Linear interpolation at (n-1)*p in sorted 365 original daily means",
  quartiles:"Q1 <= p25; Q2 p25 < Q <= p50; Q3 p50 < Q <= p75; Q4 Q > p75",
  percentile_method:"100*(number of daily means less than Q + 0.5*number equal to Q)/365",
  mean_bounds:"Sum original lower/upper concentration endpoints over all selected visits divided by the same visit count; no detection-limit substitution",
  intervals:"Closed conservative nonnegative enclosures retain original strict below-limit relations separately",
  total_nitrogen:"TKN + nitrate/nitrite from the same original activity, date, fraction, project and sample clock; ammonia is already part of TKN and is not added",
  comparison:"Flow bands describe contemporaneous upstream gauge context, not matched hydraulic travel time or a flow-weighted concentration",
  timing:"Only shared calendar dates are listed in same_date.csv; original station times are retained",
  context:"Routine nutrient cohort is distinct from the 15-date special lake chlorophyll campaign and its published seasonal summaries"};
 return {files:{"dated_values.csv":csv(dated),"sampling_calendar.csv":csv(calendar),"station_flow_summary.csv":csv(summaries),
  "station_contrasts.csv":csv(contrasts),"same_date.csv":csv(sameDate),"june12_contrast.csv":csv(event),
  "methods.json":JSON.stringify(methods,null,2)+"\n"},dated,calendar,summaries,contrasts,sameDate,event,methods};
}
