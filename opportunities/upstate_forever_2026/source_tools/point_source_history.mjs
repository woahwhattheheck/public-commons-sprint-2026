// Historical EPA discharge context, derived only from the retained original cohort.
import {parseCsv, csvString} from "./point_source_cohort.mjs";
export const HISTORY_INPUTS = {
 history:"source/point_source_context/20261013/annual_history_map_index.csv",
 periods:"source/echo_dmr/20261013/tables/dmr_loads_monitoring_period_history_2007_2026.csv",
 routing:"observations/eighteenmile_2023/npdes/routing/derived/outfall_gauge_relations.csv",
 capture:"source/echo_dmr/20261013/capture-manifest.json"
};
export const HISTORY_ROOT="source/point_source_history/20261013";
const TARGETS=new Set(["00600","00610","00620","00665","00530"]);
const FAMILY={"00600":"Total nitrogen as N","00610":"Ammonia as N","00620":"Nitrate as N","00665":"Total phosphorus as P","00530":"Total suspended solids"};
const num=value=>value==null||String(value).trim()===""?null:(Number.isFinite(Number(value))?Number(value):null);
const round=value=>value===null?null:Number(value.toFixed(8));
const sum=values=>round(values.reduce((a,b)=>a+b,0));
const key=r=>[r.ExternalPermitNmbr,r.PermFeatureNmbr,r.MonitoringLocationCode,r.ParameterCode].join("|");
const ref=r=>r.source_response_id+"|"+r.source_json_pointer;
const array=value=>{const a=JSON.parse(value||"[]");if(!Array.isArray(a))throw Error("Expected original row array");return a;};
const j=value=>JSON.stringify(value);
function periodMonths(rows,year){
 const byMonth=new Map(),unknown=[];
 for(const r of rows){
  if(r.period_status_at_capture!=="ended_by_capture_date")continue;
  const end=r.period_end_iso,start=r.derived_period_start_iso;
  if(!end||!start||Number(r.NmbrOfReport)!==1||end.slice(0,4)!==String(year)||start!==end.slice(0,7)+"-01"){unknown.push(ref(r));continue;}
  const month=Number(end.slice(5,7)),days=new Date(Date.UTC(year,month,0)).getUTCDate();
  if(end!==String(year)+"-"+String(month).padStart(2,"0")+"-"+String(days).padStart(2,"0")){unknown.push(ref(r));continue;}
  if(!byMonth.has(month))byMonth.set(month,[]);
  byMonth.get(month).push(r);
 }
 return {byMonth,unknown};
}
function singletonMonths(index){
 const selected=new Map();
 for(const [month,rows]of index.byMonth)if(rows.length===1&&num(rows[0].published_load_numeric)!==null)selected.set(month,rows[0]);
 return selected;
}
export function analyzeHistory(inputs){
 const all=parseCsv(inputs.history),periods=parseCsv(inputs.periods),routing=parseCsv(inputs.routing),capture=JSON.parse(inputs.capture);
 const index=new Map();
 for(const row of periods){const id=ref(row);if(index.has(id))throw Error("Duplicate original period identity "+id);index.set(id,row);}
 const route=new Map(routing.map(r=>[r.permit_id,r]));
 if(route.size!==routing.length)throw Error("Distinct original routing permits required");
 const annual=[],groups=new Map(),monthly=new Map(),source_rows=[];
 for(const row of all){
  if(!TARGETS.has(row.ParameterCode))continue;
  const year=Number(row.reporting_year),series=key(row),refs=array(row.period_source_rows);
  const original=refs.map(p=>{const r=index.get(p.source_response_id+"|"+p.source_json_pointer);if(!r||key(r)!==series)throw Error("Original period identity differs");return r;});
  const ended=original.filter(r=>r.period_status_at_capture==="ended_by_capture_date");
  const valid=ended.filter(r=>num(r.published_load_numeric)!==null);
  const values=valid.map(r=>num(r.published_load_numeric)),subtotal=values.length?sum(values):null;
  if((subtotal===null)!==(num(row.numeric_period_load_sum_kg)===null)||
    (subtotal!==null&&Math.abs(subtotal-num(row.numeric_period_load_sum_kg))>1e-6))throw Error("Original history subtotal differs: "+series+"|"+year);
  const mi=periodMonths(original,year),sm=singletonMonths(mi),duplicated=[...mi.byMonth].filter(([m,rows])=>rows.length>1).map(([m])=>m);
  monthly.set(series+"|"+year,sm);
  const annualN=num(row.published_single_numeric_annual_query_N_kg),annualY=num(row.published_single_numeric_annual_query_Y_kg);
  const rawN=array(row.published_annual_original_rows_query_N),rawY=array(row.published_annual_original_rows_query_Y);
  const endDates=ended.map(r=>r.period_end_iso).filter(Boolean).sort();
  const fullMonthly=sm.size===12&&mi.unknown.length===0&&duplicated.length===0&&ended.length===12&&valid.length===12;
  const completeHistorical=year<Number(capture.captured_at.slice(0,4))&&fullMonthly;
  const routeRow=route.get(row.ExternalPermitNmbr);
  if(!routeRow)throw Error("Missing original current routing relation");
  const context={
   series_id:series,year,permit_id:row.ExternalPermitNmbr,facility_name:row.FacilityName,
   reporting_feature:row.PermFeatureNmbr,monitoring_location:row.MonitoringLocationCode,
   parameter_code:row.ParameterCode,parameter:FAMILY[row.ParameterCode],unit:"kg",
   available_period_sum_kg:subtotal,published_annual_N_kg:annualN,published_annual_Y_kg:annualY,
   published_annual_minus_available_kg:annualN===null||subtotal===null?null:round(annualN-subtotal),
   published_annual_to_available_ratio:annualN===null||!subtotal?null:round(annualN/subtotal),
   annual_selector_values_equal:row.published_single_numeric_annual_query_N_kg===row.published_single_numeric_annual_query_Y_kg,
   annual_numeric_rows_N:Number(row.annual_numeric_rows_query_N),annual_numeric_rows_Y:Number(row.annual_numeric_rows_query_Y),
   annual_original_rows_N:rawN.length,annual_original_rows_Y:rawY.length,
   estimation_factors_Y:[...new Set(rawY.map(r=>r.EstFactor))],
   source_period_rows:original.length,ended_period_rows:ended.length,numeric_period_rows:valid.length,
   nonnumeric_ended_period_rows:ended.length-valid.length,future_period_rows:original.length-ended.length,
   unique_numeric_single_months:[...sm.keys()].sort((a,b)=>a-b),
   represented_numeric_months:array(row.year_months_with_numeric_load),duplicate_single_months:duplicated,
   quarterly_or_other_interval_rows:mi.unknown.length,cross_year_period_rows:Number(row.periods_crossing_calendar_year),
   full_twelve_month_numeric_support:fullMonthly,complete_historical_year:completeHistorical,
   comparison_support:completeHistorical?"twelve unique numeric monthly periods":
      year===Number(capture.captured_at.slice(0,4))?"current year at capture":
      duplicated.length?"overlapping monthly records":
      mi.unknown.length?"quarterly or other reporting interval":
      "partial or nonnumeric monthly support",
   last_ended_period:endDates.at(-1)||null,
   original_non_detect_flags:array(row.non_detect_flags),original_nodi_descriptions:array(row.nodi_descriptions),
   original_measurement_types:array(row.measurement_types),
   current_mapped_gauge_relation:routeRow.gauge_relation,gauge_id:routeRow.gauge_id,
   current_state_outfall:routeRow.state_outfall_id,
   source_period_refs:refs,source_annual_N:rawN,source_annual_Y:rawY,
   source_capture:capture.captured_at,non_detect_selector:capture.scope.non_detect,
   original_coordinate_context:row.current_geometry_relationship
  };
  annual.push(context);if(!groups.has(series))groups.set(series,[]);groups.get(series).push(context);
  for(const r of original)source_rows.push({series_id:series,year,permit_id:r.ExternalPermitNmbr,
   reporting_feature:r.PermFeatureNmbr,monitoring_location:r.MonitoringLocationCode,parameter_code:r.ParameterCode,
   original_period_end:r.Mped,period_start:r.derived_period_start_iso,period_end:r.period_end_iso,
   original_months_per_report:r.NmbrOfReport,period_status:r.period_status_at_capture,
   load_kg:num(r.published_load_numeric),original_load:r.PollutantLoad0,
   original_qualifiers:{Q1Qual:r.Q1Qual,Q2Qual:r.Q2Qual,C1Qual:r.C1Qual,C2Qual:r.C2Qual,C3Qual:r.C3Qual},
   original_nd_flag:r.NdFlag,original_nodi:r.NodiDesc,original_measurement_type:r.MeasurementType,
   original_limit_set:r.LimitSetDesignator,original_limit_season:r.LimitSeasonID,
   original_permit_effective:r.EffectiveDate,source_response_id:r.source_response_id,
   source_json_pointer:r.source_json_pointer,source_uri:r.source_uri});
 }
 annual.sort((a,b)=>a.series_id.localeCompare(b.series_id)||a.year-b.year);
 const series=[],recent=[],current=[];
 for(const[id,rows]of groups){rows.sort((a,b)=>a.year-b.year);const first=rows[0],latest=rows.at(-1),complete=rows.filter(r=>r.complete_historical_year),values=complete.map(r=>r.available_period_sum_kg),sorted=[...values].sort((a,b)=>a-b);
  series.push({series_id:id,permit_id:first.permit_id,facility_name:latest.facility_name,reporting_feature:first.reporting_feature,
   monitoring_location:first.monitoring_location,parameter_code:first.parameter_code,parameter:first.parameter,
   first_source_year:first.year,last_source_year:latest.year,source_years:rows.length,
   complete_monthly_years:complete.map(r=>r.year),complete_monthly_year_count:complete.length,
   historical_supported_min_kg:values.length?Math.min(...values):null,historical_supported_max_kg:values.length?Math.max(...values):null,
   historical_supported_median_kg:values.length?(sorted.length%2?sorted[(sorted.length-1)/2]:round((sorted[sorted.length/2-1]+sorted[sorted.length/2])/2)):null,
   latest_complete_year:complete.at(-1)?.year??null,latest_complete_period_sum_kg:complete.at(-1)?.available_period_sum_kg??null,
   current_mapped_gauge_relation:latest.current_mapped_gauge_relation,gauge_id:latest.gauge_id});
  const a=rows.find(r=>r.year===2024),b=rows.find(r=>r.year===2025);
  if(a&&b)recent.push({series_id:id,permit_id:first.permit_id,facility_name:latest.facility_name,reporting_feature:first.reporting_feature,
   parameter_code:first.parameter_code,parameter:first.parameter,year_from:2024,year_to:2025,
   from_period_sum_kg:a.available_period_sum_kg,to_period_sum_kg:b.available_period_sum_kg,
   comparable_full_years:a.complete_historical_year&&b.complete_historical_year,
   absolute_change_kg:a.complete_historical_year&&b.complete_historical_year?round(b.available_period_sum_kg-a.available_period_sum_kg):null,
   percent_change:a.complete_historical_year&&b.complete_historical_year&&a.available_period_sum_kg!==0?round(100*(b.available_period_sum_kg/a.available_period_sum_kg-1)):null,
   from_support:a.comparison_support,to_support:b.comparison_support,current_mapped_gauge_relation:b.current_mapped_gauge_relation});
  const yr=Number(capture.captured_at.slice(0,4)),now=rows.find(r=>r.year===yr),prev=rows.find(r=>r.year===yr-1);
  if(now&&prev){const nm=monthly.get(id+"|"+yr),pm=monthly.get(id+"|"+(yr-1)),common=[...nm.keys()].filter(m=>pm.has(m)).sort((a,b)=>a-b);
   const n=sum(common.map(m=>num(nm.get(m).published_load_numeric))),p=sum(common.map(m=>num(pm.get(m).published_load_numeric)));
   current.push({series_id:id,permit_id:first.permit_id,facility_name:latest.facility_name,reporting_feature:first.reporting_feature,
    parameter_code:first.parameter_code,parameter:first.parameter,year_from:yr-1,year_to:yr,common_calendar_months:common,
    common_month_count:common.length,from_common_period_sum_kg:common.length?p:null,to_common_period_sum_kg:common.length?n:null,
    common_period_change_kg:common.length?round(n-p):null,common_period_percent_change:common.length&&p!==0?round(100*(n/p-1)):null,
    omitted_current_numeric_months:[...nm.keys()].filter(m=>!pm.has(m)).sort((a,b)=>a-b),
    from_ended_nonnumeric_periods:prev.nonnumeric_ended_period_rows,to_ended_nonnumeric_periods:now.nonnumeric_ended_period_rows,
    from_nonmonthly_records:prev.quarterly_or_other_interval_rows,to_nonmonthly_records:now.quarterly_or_other_interval_rows,
    last_current_ended_period:now.last_ended_period,current_mapped_gauge_relation:now.current_mapped_gauge_relation,
    original_source_pairs:common.map(m=>({month:m,from:{source_response_id:pm.get(m).source_response_id,source_json_pointer:pm.get(m).source_json_pointer},
      to:{source_response_id:nm.get(m).source_response_id,source_json_pointer:nm.get(m).source_json_pointer}}))});
  }
 }
 const cohorts=[];
 for(const parameter_code of ["00665","00530"]){
  const selected=series.filter(s=>s.current_mapped_gauge_relation==="upstream"&&s.latest_complete_year===2025&&s.parameter_code===parameter_code);
  for(let year=2007;year<=2025;year++){
   const members=selected.map(s=>annual.find(a=>a.series_id===s.series_id&&a.year===year));
   if(members.length===3&&members.every(r=>r?.complete_historical_year))cohorts.push({year,parameter_code,parameter:FAMILY[parameter_code],
    current_mapped_gauge_relation:"upstream",gauge_id:"USGS-02186702",series_ids:selected.map(s=>s.series_id),
    cohort_description:"Three currently mapped upstream permits; historical loads retain original reporting-feature identities",
    available_period_sum_kg:sum(members.map(r=>r.available_period_sum_kg)),member_period_sums_kg:members.map(r=>({series_id:r.series_id,kg:r.available_period_sum_kg}))});
  }
 }
 const current_cohorts=[];
 const currentYear=Number(capture.captured_at.slice(0,4));
 for(const code of ["00665","00530"]){
  const selected=series.filter(s=>s.current_mapped_gauge_relation==="upstream"&&s.latest_complete_year===currentYear-1&&s.parameter_code===code);
  if(selected.length!==3)continue;
  const shared=Array.from({length:12},(_,i)=>i+1).filter(m=>selected.every(s=>monthly.get(s.series_id+"|"+currentYear)?.has(m)&&monthly.get(s.series_id+"|"+(currentYear-1))?.has(m)));
  if(!shared.length)continue;
  const members=selected.map(s=>{
   const a=monthly.get(s.series_id+"|"+(currentYear-1)),b=monthly.get(s.series_id+"|"+currentYear);
   return {series_id:s.series_id,permit_id:s.permit_id,reporting_feature:s.reporting_feature,
    from_kg:sum(shared.map(m=>num(a.get(m).published_load_numeric))),to_kg:sum(shared.map(m=>num(b.get(m).published_load_numeric))),
    original_source_pairs:shared.map(m=>({month:m,from:{source_response_id:a.get(m).source_response_id,source_json_pointer:a.get(m).source_json_pointer},
      to:{source_response_id:b.get(m).source_response_id,source_json_pointer:b.get(m).source_json_pointer}}))};
  });
  const from=sum(members.map(x=>x.from_kg)),to=sum(members.map(x=>x.to_kg));
  current_cohorts.push({parameter_code:code,parameter:FAMILY[code],gauge_id:"USGS-02186702",
   current_mapped_gauge_relation:"upstream",year_from:currentYear-1,year_to:currentYear,
   common_calendar_months:shared,common_month_count:shared.length,series_ids:selected.map(s=>s.series_id),
   from_common_period_sum_kg:from,to_common_period_sum_kg:to,common_period_change_kg:round(to-from),
   common_period_percent_change:from!==0?round(100*(to/from-1)):null,members});
 }
 return {schema:"upstate.point-source-history-analysis/v1",source_capture:capture.captured_at,
  scope:{permits:capture.permits,source_years:[2007,2026],parameters:[...TARGETS],non_detect_selector:capture.scope.non_detect,
   annual_queries:capture.scope.annual_estimation_selectors,gauge_relation_basis:"Current retained original outfall/NHD routing, applied as contextual cohort labels"},
  counts:{original_history_rows:all.length,original_period_rows:periods.length,selected_annual_rows:annual.length,selected_series:series.length,
   selected_original_period_rows:source_rows.length,supported_historical_annual_rows:annual.filter(r=>r.complete_historical_year).length,
   comparable_2024_2025_series:recent.filter(r=>r.comparable_full_years).length,
   same_month_2025_2026_series:current.filter(r=>r.common_month_count>0).length,
   equal_annual_selector_rows:annual.filter(r=>r.annual_selector_values_equal).length,
   comparable_numeric_annual_selector_rows:annual.filter(r=>r.published_annual_N_kg!==null&&r.published_annual_Y_kg!==null).length,
   equal_numeric_annual_selector_rows:annual.filter(r=>r.published_annual_N_kg!==null&&r.published_annual_Y_kg!==null&&r.published_annual_N_kg===r.published_annual_Y_kg).length,
   multiple_original_annual_rows:annual.filter(r=>r.annual_original_rows_N>1||r.annual_original_rows_Y>1).length},
  annual,series,recent,current,cohorts,current_cohorts,source_periods:source_rows};
}
export function tableCsv(rows){
 if(!rows.length)return "";
 const columns=[...new Set(rows.flatMap(r=>Object.keys(r)))];
 const quote=v=>{const s=v==null?"":typeof v==="object"?JSON.stringify(v):String(v);return /[",\r\n]/.test(s)?'"'+s.replace(/"/g,'""')+'"':s;};
 return columns.join(",")+"\n"+rows.map(r=>columns.map(k=>quote(r[k])).join(",")).join("\n")+"\n";
}
