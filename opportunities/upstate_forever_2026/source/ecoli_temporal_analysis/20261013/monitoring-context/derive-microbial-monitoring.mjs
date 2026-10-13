import {buildOutputs,csvOutput,parseCSV} from "../analysis.mjs";

const GAUGE="USGS-02177000";
const unique=values=>[...new Set(values)].sort();
function json(value){return JSON.stringify(value,null,2)+"\n"}
function groups(rows,key){const found=new Map();for(const row of rows){const k=key(row);if(!found.has(k))found.set(k,[]);found.get(k).push(row)}return found}
function coverage(rows,period,extra={}){
 const routine=rows.filter(r=>r.activity_type==="Sample-Routine");
 return {period,activities:rows.length,routine_activities:routine.length,field_replicates:rows.length-routine.length,
 sampled_dates:unique(rows.map(r=>r.date)).length,station_count:unique(rows.map(r=>r.station_id)).length,
 first_date:rows.length?unique(rows.map(r=>r.date))[0]:null,last_date:rows.length?unique(rows.map(r=>r.date)).at(-1):null,
 ...extra};
}
export function deriveMicrobialMonitoring({result_csv,station_csv,flow_json,source_inputs=[]}){
 const computed=buildOutputs(result_csv,station_csv,typeof flow_json==="string"?JSON.parse(flow_json):flow_json);
 const original= parseCSV(station_csv).rows,records=computed.analysis.records;
 if(original.length!==36||records.length!==730||computed.flow.daily.length!==365)throw Error("Original microbial source edition changed");
 const observations=records.map(r=>({...r,observation_id:r.source_file+"#row="+r.source_row,characteristic:"Escherichia coli",
  lower:Number.isFinite(r.lower)?r.lower:null,upper:Number.isFinite(r.upper)?r.upper:null,
  upper_unbounded:r.upper_unbounded===true,source_csv:"source/ecoli_utility_context/20261013/results-with-provenance.csv"}));
 const byActivity=groups(observations,r=>JSON.stringify([r.station_id,r.activity_id]));
 const activities=[...byActivity.values()].map(rows=>{
  const r=rows[0];if(rows.some(x=>x.date!==r.date||x.activity_type!==r.activity_type))throw Error("Original activity identity spans incompatible records");
  return {station_id:r.station_id,activity_id:r.activity_id,date:r.date,activity_type:r.activity_type,time:r.time,timezone:r.timezone,
   characteristics:unique(rows.map(x=>x.characteristic)),result_rows:rows.length,censored_results:rows.filter(x=>["above_limit","below_limit","not_detected"].includes(x.status)).length,
   source_references:rows.map(x=>({source_file:x.source_file,source_row:x.source_row,observation_id:x.observation_id})),
   source_comment_flags:unique(rows.flatMap(x=>x.source_comment_flags))};
 }).sort((a,b)=>a.date.localeCompare(b.date)||a.station_id.localeCompare(b.station_id)||a.activity_id.localeCompare(b.activity_id));
 const stationIds=new Set(original.map(r=>r.station_id));
 if(stationIds.size!==36||observations.some(r=>!stationIds.has(r.station_id)))throw Error("Original station membership differs");
 const stations=original.map(r=>({...r,longitude:Number(r.original_longitude),latitude:Number(r.original_latitude),datum:r.original_coordinate_datum,
  records:Number(r.records),activities:activities.filter(a=>a.station_id===r.station_id).length,
  gauge_network_relation:r.station_id===GAUGE?"same_original_station":"not_established_for_this_source",
  coordinate_basis:"Unchanged original WQP station coordinates and declared datum; exact station IDs drive matching."}));
 if(stations.some(s=>!Number.isFinite(s.longitude)||!Number.isFinite(s.latitude)||!["WGS84","NAD83"].includes(s.datum)))throw Error("Original geographic coordinate metadata differs");
 const p95=computed.summary.flow_sampling_coverage.percentile95_linear;
 const flowRows=computed.flow.daily.map(r=>({date:r.date,mean_cfs:r.value,qualifiers:r.qualifiers,
  original_date_time:r.original_date_time,source_values_index:r.source_block,source_record_index:r.source_index,
  source_id:"USGS:02177000:00060:00003",p95_cfs:p95,at_or_above_annual_p95:r.value>=p95}));
 const gaugeActivities=activities.filter(r=>r.station_id===GAUGE&&r.activity_type==="Sample-Routine");
 const episodes=[];
 for(const day of flowRows){
  if(!day.at_or_above_annual_p95)continue;
  const last=episodes.at(-1),consecutive=last&&Date.parse(day.date)-Date.parse(last.end_date)===86400000;
  const episode=consecutive?last:{event_id:GAUGE+"-"+day.date,start_date:day.date,end_date:day.date,days:0,peak_cfs:0,
    gauge_station_id:GAUGE,flow_scope_station_ids:[GAUGE],daily_source_references:[]};
  if(!consecutive)episodes.push(episode);
  episode.end_date=day.date;episode.days++;episode.peak_cfs=Math.max(episode.peak_cfs,day.mean_cfs);
  episode.daily_source_references.push({date:day.date,source_id:day.source_id,source_values_index:day.source_values_index,source_record_index:day.source_record_index,qualifiers:day.qualifiers});
 }
 for(const episode of episodes){
  const rows=gaugeActivities.filter(r=>r.date>=episode.start_date&&r.date<=episode.end_date);
  Object.assign(episode,{sampled_dates:unique(rows.map(r=>r.date)).length,station_activities:rows.length,
   sampled_stations:unique(rows.map(r=>r.station_id)),missing_stations:rows.length?[]:[GAUGE],
   source_activity_ids:rows.map(r=>r.activity_id),sampling_scope:"Original same-station routine microbial activities only"});
 }
 const annual=[...groups(activities,r=>r.date.slice(0,4))].sort().map(([year,rows])=>{
  const days=flowRows.filter(r=>r.date.startsWith(year)),high=days.filter(r=>r.at_or_above_annual_p95),
   sampled=gaugeActivities.filter(r=>r.date.startsWith(year)),sampledDates=new Set(sampled.map(r=>r.date));
  return coverage(rows,year,{daily_records:days.length,extreme_flow_days:days.length?high.length:null,
   extreme_sampled_dates:days.length?high.filter(r=>sampledDates.has(r.date)).length:null,
   flow_scope_sampled_dates:days.length?sampledDates.size:null,
   extreme_flow_volume_percent:days.length?100*high.reduce((a,r)=>a+r.mean_cfs,0)/days.reduce((a,r)=>a+r.mean_cfs,0):null,
   gauge_station_id:GAUGE,flow_scope_station_ids:[GAUGE],flow_scope:"Same original station; received daily series is 2022 only"});
 });
 const stationYear=[...groups(activities,r=>r.station_id+"|"+r.date.slice(0,4))].sort().map(([key,rows])=>coverage(rows,rows[0].date.slice(0,4),{station_id:rows[0].station_id}));
 const monthly=[...groups(activities,r=>r.station_id+"|"+r.date.slice(0,7))].sort().map(([key,rows])=>coverage(rows,rows[0].date.slice(0,7),{station_id:rows[0].station_id}));
 const interpretation=[
  "The original utility cohort contains 730 observations at 36 stations: 729 routine results and 1 original field replicate. Activity types remain separate.",
  "Original station identifiers, activity identifiers, analytical methods, result and limit units, censoring bounds, comments, sample clocks and source rows remain attached.",
  "Daily mean discharge and annual-P95 episodes apply only to the same original station USGS-02177000. The other 35 stations have no site-specific discharge established by this source.",
  "The daily-flow series contains all 365 dates of 2022. Other dates remain outside the received series, including future saved calendar dates.",
  "None of the 16 original same-station microbial sample dates reaches the 2022 daily-flow P95. High-flow episodes are consecutive received calendar days at or above that annual threshold.",
  "The threshold uses linear interpolation at rank(n−1)×0.95 over 365 original daily means. Flow qualifiers and record indices are retained.",
  "Two stations retain original NAD83 coordinates and 34 retain WGS84. Station-ID matching does not change coordinates or datum; cross-datum distance diagnostics require a separately defined transformation.",
  "Whole-cohort sampling counts describe the selected 36 stations. Hydrologic episode sample counts describe only routine activities at the original gauge station.",
  "Information-only and analysis-interruption comments remain visible. Monitoring support preserves the original results; the accompanying analysis offers explicit comment sensitivity.",
  "Censoring bounds describe reported numerical support. They are not confidence intervals. Native plan dates, station bindings, costs and priorities retain their original choices."
 ];
 const source={schema:"upstate.monitoring-observed-source/v2",title:"Utility microbial observations: original sampling and same-station flow support",
  source_edition:"utility-microbial-2021-2025-monitoring-v1",source_period:{start_inclusive:"2021-01-01",end_inclusive:"2025-12-31"},
  flow_scope:{mode:"same_station_only",gauge_station_id:GAUGE,station_ids:[GAUGE],start_inclusive:"2022-01-01",end_inclusive:"2022-12-31"},
  gauge:{station_id:GAUGE,station_name:stations.find(s=>s.station_id===GAUGE).station_name,unit:"ft3/s",original_series_name:"USGS:02177000:00060:00003"},
  stations,activities,observations,daily_flow:flowRows,relations:[],paired_contrasts:[],annual_coverage:annual,
  station_year_coverage:stationYear,monthly_coverage:monthly,high_flow_episodes:episodes,
  station_result_summaries:computed.analysis.station,source_inputs,interpretation};
 const summary={schema:"upstate.monitoring-observed-source-summary/v1",source_edition:source.source_edition,stations:stations.length,
  observations:observations.length,activities:activities.length,routine_observations:observations.filter(r=>r.activity_type==="Sample-Routine").length,
  field_replicates:observations.filter(r=>r.activity_type!=="Sample-Routine").length,gauge_days:flowRows.length,gauge_station_id:GAUGE,
  gauge_routine_activities:gaugeActivities.length,p95_cfs:p95,high_flow_days:flowRows.filter(r=>r.at_or_above_annual_p95).length,
  high_flow_episodes:episodes.length,unsampled_same_station_episodes:episodes.filter(r=>r.sampled_dates===0).length,
  datums:Object.fromEntries([...groups(stations,s=>s.datum)].map(([datum,rows])=>[datum,rows.length])),interpretation};
 return {source,summary,files:{"monitoring-context.json":json(source),"monitoring-activities.csv":csvOutput(activities),
  "monitoring-high-flow-episodes.csv":csvOutput(episodes),"original-stations.csv":csvOutput(stations),"context-summary.json":json(summary)}};
}
