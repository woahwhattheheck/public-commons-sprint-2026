// Exact matched-period accounting of original EPA discharge load and volume.
import {parseCsv} from "./point_source_cohort.mjs";
export const DRIVER_INPUTS={
 history:"source/point_source_history/20261013/analysis.json",
 periods:"source/echo_dmr/20261013/tables/dmr_loads_monitoring_period_history_2007_2026.csv",
 guide:"source/echo_dmr/20261013/field-guide.json"
};
export const DRIVER_ROOT="source/point_source_drivers/20261013";
const number=x=>x==null||String(x).trim()===""?null:Number.isFinite(Number(x))?Number(x):null;
const rounded=x=>x==null?null:Number(x.toFixed(10));
const total=xs=>xs.reduce((a,b)=>a+b,0);
const identity=r=>[r.ExternalPermitNmbr,r.PermFeatureNmbr,r.MonitoringLocationCode,r.ParameterCode].join("|");
const reference=r=>r.source_response_id+"|"+r.source_json_pointer;
const pct=(a,b)=>a===0?null:rounded((b/a-1)*100);
function original(r){
 return {source_response_id:r.source_response_id,source_json_pointer:r.source_json_pointer,source_uri:r.source_uri,
  original_period_end:r.Mped,period_start:r.derived_period_start_iso,period_end:r.period_end_iso,
  original_months_per_report:r.NmbrOfReport,original_load:r.PollutantLoad0,original_volume:r.WastewaterFlow,
  original_average_concentration:r.AvgConcentration0,original_average_daily_load:r.AvgPollutantLoad0,
  original_average_daily_flow:r.AvgWastewaterFlow,measurement_type:r.MeasurementType,
  original_quantity_1:r.Mq1,original_quantity_2:r.Mq2,original_concentration_1:r.Mc1,
  original_concentration_2:r.Mc2,original_concentration_3:r.Mc3,
  original_qualifiers:{Q1Qual:r.Q1Qual,Q2Qual:r.Q2Qual,C1Qual:r.C1Qual,C2Qual:r.C2Qual,C3Qual:r.C3Qual},
  non_detect_flag:r.NdFlag,quality_flag:r.QcFlag,nodi_description:r.NodiDesc,
  percent_loads_dmr:r.PctLoadsDmr,percent_loads_limits:r.PctLoadsLimits,
  load_unit:r.published_load_unit,volume_unit:r.published_wastewater_volume_unit,
  concentration_unit:r.published_average_concentration_unit};
}
function monthRecord(row,series,year,month){
 if(identity(row)!==series||row.period_status_at_capture!=="ended_by_capture_date"||Number(row.NmbrOfReport)!==1)throw Error("Different original monthly identity");
 const prefix=String(year)+"-"+String(month).padStart(2,"0");
 const days=new Date(Date.UTC(year,month,0)).getUTCDate();
 if(row.derived_period_start_iso!==prefix+"-01"||row.period_end_iso!==prefix+"-"+days)throw Error("Different exact original month");
 if(row.published_load_unit!=="kg/monitoring_period"||row.published_wastewater_volume_unit!=="million_US_gallons/monitoring_period")throw Error("Original quantitative units differ");
}
export function buildDriverAnalysis(inputs){
 const history=JSON.parse(inputs.history),rows=parseCsv(inputs.periods),guide=JSON.parse(inputs.guide);
 if(history.schema!=="upstate.point-source-history-analysis/v1"||guide.schema!=="upstate.echo-field-guide/v1")throw Error("Select the retained original source editions");
 const index=new Map();for(const row of rows){const key=reference(row);if(index.has(key))throw Error("Duplicate original source pointer");index.set(key,row);}
 const select=ref=>{const r=index.get(ref.source_response_id+"|"+ref.source_json_pointer);if(!r)throw Error("Missing original period");return r;};
 const windows=[],coverage=[];
 for(const r of history.current){
  if(!r.common_month_count){coverage.push({window:"same_month_2025_2026",series_id:r.series_id,disposition:"No unique numeric common monthly periods"});continue;}
  windows.push({...r,window:"same_month_2025_2026",pairs:r.original_source_pairs,months:r.common_calendar_months});
 }
 for(const r of history.recent){
  if(!r.comparable_full_years){coverage.push({window:"full_year_2024_2025",series_id:r.series_id,disposition:"Both years require twelve unique numeric monthly periods"});continue;}
  const a=history.annual.find(x=>x.series_id===r.series_id&&x.year===2024),b=history.annual.find(x=>x.series_id===r.series_id&&x.year===2025);
  const byMonth=annual=>{const map=new Map();for(const ref of annual.source_period_refs){const row=select(ref),m=Number(row.period_end_iso.slice(5,7));if(map.has(m))throw Error("Duplicate original full-year month");map.set(m,ref);}return map;};
  const am=byMonth(a),bm=byMonth(b),months=Array.from({length:12},(_,i)=>i+1);
  windows.push({...r,window:"full_year_2024_2025",months,pairs:months.map(month=>({month,from:am.get(month),to:bm.get(month)}))});
 }
 const summaries=[],monthly=[];
 for(const w of windows){
  const records=[];
  for(const p of w.pairs){
   const a=select(p.from),b=select(p.to);monthRecord(a,w.series_id,w.year_from,p.month);monthRecord(b,w.series_id,w.year_to,p.month);
   const m0=number(a.published_load_numeric),m1=number(b.published_load_numeric),v0=number(a.published_wastewater_volume_numeric),v1=number(b.published_wastewater_volume_numeric);
   if(m0==null||m1==null||m0<0||m1<0)throw Error("Retained comparison has a nonnumeric or negative load");
   const usable=v0!=null&&v1!=null&&v0>0&&v1>0,i0=usable?m0/v0:null,i1=usable?m1/v1:null;
   const volume=usable?(v1-v0)*(i0+i1)/2:null,intensity=usable?(i1-i0)*(v0+v1)/2:null;
   const row={window:w.window,series_id:w.series_id,permit_id:w.permit_id,facility_name:w.facility_name,
    reporting_feature:w.reporting_feature,parameter_code:w.parameter_code,parameter:w.parameter,
    year_from:w.year_from,year_to:w.year_to,month:p.month,current_mapped_gauge_relation:w.current_mapped_gauge_relation,
    from_load_kg:m0,to_load_kg:m1,load_change_kg:rounded(m1-m0),
    from_volume_mgal:v0,to_volume_mgal:v1,volume_change_mgal:v0==null||v1==null?null:rounded(v1-v0),
    from_load_per_mgal_kg:rounded(i0),to_load_per_mgal_kg:rounded(i1),
    volume_accounting_kg:rounded(volume),intensity_accounting_kg:rounded(intensity),
    accounting_residual_kg:usable?rounded(m1-m0-volume-intensity):null,
    usable_positive_volume_pair:usable,volume_support:usable?"Both original published volumes are positive":"Missing or nonpositive original published volume",
    from_published_average_concentration_mg_l:number(a.published_average_concentration_numeric),
    to_published_average_concentration_mg_l:number(b.published_average_concentration_numeric),
    measurement_type_changed:a.MeasurementType!==b.MeasurementType,
    source_from:original(a),source_to:original(b)};
   records.push({row,m0,m1,v0,v1,i0,i1,volume,intensity,usable});monthly.push(row);
  }
  const complete=records.every(r=>r.usable),m0=total(records.map(r=>r.m0)),m1=total(records.map(r=>r.m1));
  const v0=complete?total(records.map(r=>r.v0)):null,v1=complete?total(records.map(r=>r.v1)):null;
  const i0=complete?m0/v0:null,i1=complete?m1/v1:null;
  const ve=complete?total(records.map(r=>r.volume)):null,ie=complete?total(records.map(r=>r.intensity)):null;
  summaries.push({window:w.window,series_id:w.series_id,permit_id:w.permit_id,facility_name:w.facility_name,
   reporting_feature:w.reporting_feature,parameter_code:w.parameter_code,parameter:w.parameter,year_from:w.year_from,year_to:w.year_to,
   common_calendar_months:w.months,common_month_count:w.months.length,current_mapped_gauge_relation:w.current_mapped_gauge_relation,
   complete_published_volume_support:complete,usable_volume_pairs:records.filter(r=>r.usable).length,
   from_load_kg:rounded(m0),to_load_kg:rounded(m1),load_change_kg:rounded(m1-m0),load_change_percent:pct(m0,m1),
   from_volume_mgal:rounded(v0),to_volume_mgal:rounded(v1),volume_change_mgal:complete?rounded(v1-v0):null,
   volume_change_percent:complete?pct(v0,v1):null,
   from_window_load_per_mgal_kg:rounded(i0),to_window_load_per_mgal_kg:rounded(i1),
   window_load_intensity_change_percent:complete?pct(i0,i1):null,
   paired_month_volume_accounting_kg:rounded(ve),paired_month_intensity_accounting_kg:rounded(ie),
   paired_month_accounting_residual_kg:complete?rounded(m1-m0-ve-ie):null,
   whole_window_volume_accounting_kg:complete?rounded((v1-v0)*(i0+i1)/2):null,
   whole_window_intensity_accounting_kg:complete?rounded((i1-i0)*(v0+v1)/2):null,
   accounting_method:"Monthly-paired symmetric identity; whole-window identity retained separately",
   measurement_types:[...new Set(records.flatMap(r=>[r.row.source_from.measurement_type,r.row.source_to.measurement_type]))],
   measurement_type_changed_months:records.filter(r=>r.row.measurement_type_changed).map(r=>r.row.month),
   original_source_pairs:w.pairs});
 }
 const cohorts=[];
 for(const window of ["full_year_2024_2025","same_month_2025_2026"])for(const code of ["00665","00530"]){
  const selected=summaries.filter(r=>r.window===window&&r.parameter_code===code&&r.current_mapped_gauge_relation==="upstream");
  if(selected.length!==3||!selected.every(r=>r.complete_published_volume_support))continue;
  const months=JSON.stringify(selected[0].common_calendar_months);if(!selected.every(r=>JSON.stringify(r.common_calendar_months)===months))continue;
  const sum=key=>rounded(total(selected.map(r=>r[key])));
  cohorts.push({window,parameter_code:code,parameter:selected[0].parameter,common_calendar_months:selected[0].common_calendar_months,
   year_from:selected[0].year_from,year_to:selected[0].year_to,current_mapped_gauge_relation:"upstream",gauge_id:"USGS-02186702",
   member_series_ids:selected.map(r=>r.series_id),from_load_kg:sum("from_load_kg"),to_load_kg:sum("to_load_kg"),load_change_kg:sum("load_change_kg"),
   from_volume_mgal:sum("from_volume_mgal"),to_volume_mgal:sum("to_volume_mgal"),
   paired_month_volume_accounting_kg:sum("paired_month_volume_accounting_kg"),
   paired_month_intensity_accounting_kg:sum("paired_month_intensity_accounting_kg"),
   basis:"Sum of the three separate original-series monthly paired identities; pollutant parameter remains distinct"});
 }
 return{schema:"upstate.point-source-load-volume-analysis/v1",source_capture:history.source_capture,
  units:{mass:"kg",volume:"million US gallons",load_intensity:"kg per million US gallons",publisher_average_concentration:"mg/L"},
  method:{identity:"M = V × I; I = M / V",monthly_volume_component:"(V1-V0) × (I0+I1)/2",
   monthly_intensity_component:"(I1-I0) × (V0+V1)/2",
   summary:"Sum exact matched monthly components; each pair sums to its original reported mass change",
   interpretation:"Accounting of original published load and volume, retaining publisher concentrations and measurement choices as separate source context",
   rounding:"Inputs are original displayed API values; calculations use full numeric precision, output values round to ten decimal places",
   sources:guide.primary_method_sources},
  counts:{series_windows:summaries.length,matched_month_pairs:monthly.length,
   complete_volume_windows:summaries.filter(x=>x.complete_published_volume_support).length,
   unavailable_windows:coverage.length,cohorts:cohorts.length},
  summaries,monthly,cohorts,coverage};
}
