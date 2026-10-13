import {prepareRecords,parseCSV,summarize,csvOutput} from "./analysis.mjs";

function compareCalendarSupport(csv,stationCsv,options={}){
 const all=prepareRecords(csv).filter(r=>r.activity_type==="Sample-Routine");
 const years=[...new Set(all.map(r=>r.year))].sort();
 const firstYear=options.firstYear||years[0],lastYear=options.lastYear||years.at(-1);
 if(!years.includes(firstYear)||!years.includes(lastYear)||firstYear>=lastYear)throw Error("Choose two original calendar years in ascending order");
 const requiredYears=options.requiredYears||years;
 if(!Array.isArray(requiredYears)||!requiredYears.length||requiredYears.some(y=>!years.includes(y)))throw Error("Required panel year is absent");
 const members=new Map(parseCSV(stationCsv).rows.map(s=>[s.station_id,s]));
 const key=r=>JSON.stringify([r.utility_id,r.station_id,r.method_context,r.method,r.unit]);
 const grouped=new Map();
 for(const r of all){if(!members.has(r.station_id))throw Error("Missing original station membership");const k=key(r);if(!grouped.has(k))grouped.set(k,[]);grouped.get(k).push(r);}
 const panel=[...grouped.entries()].filter(([,rows])=>requiredYears.every(year=>rows.some(r=>r.year===year))).sort(([a],[b])=>a.localeCompare(b));
 const comparisons=[],membership=new Map();
 const finite=x=>Number.isFinite(x)?x:null;
 for(const [groupKey,rows]of panel){
  const base=rows[0],station=members.get(base.station_id);
  for(const commentMode of ["all_original","exclude_information_only"]){
   const eligible=rows.filter(r=>commentMode==="all_original"||!r.source_comment_flags.includes("information_only"));
   const before=eligible.filter(r=>r.year===firstYear),after=eligible.filter(r=>r.year===lastYear);
   const common=[...new Set(before.map(r=>r.month))].filter(m=>after.some(r=>r.month===m)).sort((a,b)=>a-b);
   for(const calendarMode of ["all_dates","common_calendar_months"]){
    const earlier=calendarMode==="all_dates"?before:before.filter(r=>common.includes(r.month));
    const later=calendarMode==="all_dates"?after:after.filter(r=>common.includes(r.month));
    const a=summarize(earlier),b=summarize(later);
    const valid=a.interval_records>0&&b.interval_records>0;
    const upperA=a.median_upper_unbounded?Infinity:a.median_upper,upperB=b.median_upper_unbounded?Infinity:b.median_upper;
    const lower=valid?b.median_lower-upperA:null,upper=valid?upperB-a.median_lower:null;
    const direction=!valid?"no_interpretable_support":lower>0?"higher":upper<0?"lower":lower===0&&upper===0?"equal":"interval_contains_zero";
    const id=[base.utility_id,base.station_id,base.method_context,base.method,base.unit,firstYear,lastYear,commentMode,calendarMode].join("|");
    comparisons.push({comparison_id:id,utility_id:base.utility_id,station_id:base.station_id,station_name:station.station_name,method_context:base.method_context,method:base.method,unit:base.unit,first_year:firstYear,last_year:lastYear,comment_mode:commentMode,calendar_mode:calendarMode,
     available_first_records:before.length,available_last_records:after.length,common_calendar_months:common,
     first_records:a.records,last_records:b.records,first_interval_records:a.interval_records,last_interval_records:b.interval_records,
     first_information_only:a.information_only_comments,last_information_only:b.information_only_comments,
     first_median_lower:a.median_lower,first_median_upper:a.median_upper,first_median_upper_unbounded:a.median_upper_unbounded,
     last_median_lower:b.median_lower,last_median_upper:b.median_upper,last_median_upper_unbounded:b.median_upper_unbounded,
     change_lower:finite(lower),change_upper:finite(upper),change_lower_unbounded:lower===-Infinity,change_upper_unbounded:upper===Infinity,direction});
    for(const r of [...earlier,...later]){
     const recordKey=r.source_file+"|"+r.source_row;
     if(!membership.has(recordKey))membership.set(recordKey,{...r,upper:r.upper===Infinity?null:r.upper,upper_unbounded:r.upper===Infinity,included_comparisons:[]});
     membership.get(recordKey).included_comparisons.push(id);
    }
   }
  }
 }
 const sensitivityPanel=panel.filter(([,rows])=>requiredYears.every(year=>rows.some(r=>r.year===year&&!r.source_comment_flags.includes("information_only")))).map(([,rows])=>rows[0].station_id);
 const reversals=[];
 for(const [,rows]of panel){
  const stationId=rows[0].station_id,identity=rows[0];
  const sameGroup=r=>r.utility_id===identity.utility_id&&r.station_id===identity.station_id&&r.method_context===identity.method_context&&r.method===identity.method&&r.unit===identity.unit;
  for(const commentMode of ["all_original","exclude_information_only"]){
   const original=comparisons.find(r=>sameGroup(r)&&r.comment_mode===commentMode&&r.calendar_mode==="all_dates");
   const matched=comparisons.find(r=>sameGroup(r)&&r.comment_mode===commentMode&&r.calendar_mode==="common_calendar_months");
   if(["higher","lower"].includes(original.direction)&&["higher","lower"].includes(matched.direction)&&original.direction!==matched.direction)reversals.push({station_id:stationId,method_context:identity.method_context,method:identity.method,unit:identity.unit,comment_mode:commentMode,all_date_direction:original.direction,common_month_direction:matched.direction,all_dates_change:[original.change_lower,original.change_upper],common_months_change:[matched.change_lower,matched.change_upper],common_months:matched.common_calendar_months});
  }
 }
 const sourceRows=[...membership.values()].sort((a,b)=>a.station_id.localeCompare(b.station_id)||a.date.localeCompare(b.date));
 const summary={schema:"upstate.microbial-calendar-support/v1",first_year:firstYear,last_year:lastYear,required_panel_years:requiredYears,original_repeat_panel_stations:panel.map(([,r])=>r[0].station_id),information_only_sensitivity_panel_stations:sensitivityPanel,
  comparison_rows:comparisons.length,original_source_rows:sourceRows.length,direction_reversals:reversals,
  method:"Compare each original station/method/unit separately. The repeated panel has routine observations in every required year before comment filtering. For each comment mode, compare all observed dates and, separately, only calendar months represented in both selected years. Preserve all observations and source-row memberships. Bound median differences by later_lower-earlier_upper and later_upper-earlier_lower.",
  interpretation:"These are differences between the observed sample medians, conditional on selected calendar support and comment policy. Equal month coverage does not align exact dates, flows, weather or land management. Interval bounds express original censoring; they are not sampling confidence intervals."};
 return {comparisons,sourceRows,summary,files:{"calendar-support-comparisons.csv":csvOutput(comparisons),"calendar-support-source-rows.csv":csvOutput(sourceRows),"calendar-support-summary.json":JSON.stringify(summary,null,2)+"\n"}};
}

export {compareCalendarSupport};
