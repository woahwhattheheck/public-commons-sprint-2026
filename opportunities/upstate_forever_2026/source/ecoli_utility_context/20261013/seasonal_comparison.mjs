import {readFile,writeFile} from "node:fs/promises";
import {createHash} from "node:crypto";
import {dirname,resolve} from "node:path";
import {fileURLToPath} from "node:url";

/** Original utility E. coli: sampled-day and common-month comparisons.
 * Pure arithmetic over retained WQP rows; no imputation, fitting or significance test.
 */
export const VERSION = "upstate.utility-microbial-seasonal-comparison/v1";
export const SOURCE_SHA256 = "b6cf7d334c6b8bb1a174374c30e8ea3081dd1f05be2418040272c581a49264a8";
const SUPPORT = [
 "MonitoringLocationIdentifier", "CharacteristicName",
 "ResultAnalyticalMethod/MethodIdentifierContext", "ResultAnalyticalMethod/MethodIdentifier",
 "ResultSampleFractionText", "ResultValueTypeName", "ResultWeightBasisText",
 "ResultTimeBasisText", "ResultTemperatureBasisText", "ResultParticleSizeBasisText",
 "StatisticalBaseCode", "ActivityMediaName", "ActivityMediaSubdivisionName",
 "SampleCollectionMethod/MethodIdentifier", "SampleCollectionMethod/MethodIdentifierContext",
 "ResultStatusIdentifier", "MeasureQualifierCode",
 "ActivityDepthHeightMeasure/MeasureValue", "ActivityDepthHeightMeasure/MeasureUnitCode",
 "ActivityDepthAltitudeReferencePointText", "ActivityTopDepthHeightMeasure/MeasureValue",
 "ActivityTopDepthHeightMeasure/MeasureUnitCode", "ActivityBottomDepthHeightMeasure/MeasureValue",
 "ActivityBottomDepthHeightMeasure/MeasureUnitCode",
 "ResultDepthHeightMeasure/MeasureValue", "ResultDepthHeightMeasure/MeasureUnitCode",
 "ResultDepthAltitudeReferencePointText"
];
const CALENDAR = ["MonitoringLocationIdentifier", "ResultAnalyticalMethod/MethodIdentifierContext",
 "ResultAnalyticalMethod/MethodIdentifier", "ActivityTypeCode"];
const canonical = value => value && typeof value === "object" && !Array.isArray(value)
 ? Object.fromEntries(Object.keys(value).sort().map(k=>[k,canonical(value[k])]))
 : Array.isArray(value) ? value.map(canonical) : value;
const jsonKey = value => JSON.stringify(canonical(value));
const effectiveUnit = row => row["ResultMeasure/MeasureUnitCode"] ||
 row["DetectionQuantitationLimitMeasure/MeasureUnitCode"] || "";
const identity = (row,fields) => ({...Object.fromEntries(fields.map(k=>[k,row[k]||""])),
 original_effective_unit:effectiveUnit(row)});
const number = text => text.trim()==="" ? null : Number(text);
const point = value => ({lower:value,upper:value,lower_open:false,upper_open:false});
function interval(row) {
 const value=number(row.ResultMeasureValue), limit=number(row["DetectionQuantitationLimitMeasure/MeasureValue"]),
 condition=row.ResultDetectionConditionText, kind=row.DetectionQuantitationLimitTypeName;
 if(value!==null) {
  if(!Number.isFinite(value)||value<0||condition||!row["ResultMeasure/MeasureUnitCode"])return null;
  return point(value);
 }
 if(limit===null||!Number.isFinite(limit)||limit<0||
    row["DetectionQuantitationLimitMeasure/MeasureUnitCode"]!==effectiveUnit(row))return null;
 if((condition==="Not Detected"||condition==="Present Below Quantification Limit")&&
    ["Lower Reporting Limit","Lower Quantitation Limit"].includes(kind)&&limit>0)
  return {lower:0,upper:limit,lower_open:false,upper_open:true};
 if(condition==="Present Above Quantification Limit"&&kind==="Upper Quantitation Limit")
  return {lower:limit,upper:Infinity,lower_open:true,upper_open:true};
 return null;
}
function average(values) {
 if(!values.length||values.some(x=>x===null))return null;
 return {lower:values.some(x=>x.lower===-Infinity)?-Infinity:values.reduce((s,x)=>s+x.lower/values.length,0),
  upper:values.some(x=>x.upper===Infinity)?Infinity:values.reduce((s,x)=>s+x.upper/values.length,0),
  lower_open:values.some(x=>x.lower_open),upper_open:values.some(x=>x.upper_open)};
}
function subtract(after,before) {
 return after&&before ? {lower:after.lower-before.upper,upper:after.upper-before.lower,
  lower_open:after.lower_open||before.upper_open,upper_open:after.upper_open||before.lower_open}:null;
}
function direction(value) {
 if(!value)return "unavailable";
 if(value.lower>0||(value.lower===0&&value.lower_open))return "higher";
 if(value.upper<0||(value.upper===0&&value.upper_open))return "lower";
 if(value.lower===0&&value.upper===0)return "equal";
 return "overlaps_zero";
}
function retainInterval(value) {
 return value&&{lower:Number.isFinite(value.lower)?value.lower:null,
  upper:Number.isFinite(value.upper)?value.upper:null,lower_open:value.lower_open,upper_open:value.upper_open,
  lower_unbounded:value.lower===-Infinity,upper_unbounded:value.upper===Infinity};
}
const informationOnly = row => [row.ResultCommentText,row.ResultLaboratoryCommentText,row.ActivityCommentText]
 .some(value=>/information\s+only/i.test(value||""));
function countSupport(records) {
 return {records:records.length,quantified:records.filter(r=>r.interval&&r.interval.lower===r.interval.upper).length,
  censored:records.filter(r=>r.interval&&r.interval.lower!==r.interval.upper).length,
  unresolved:records.filter(r=>r.interval===null).length,
  information_only_comments:records.filter(r=>r.information_only_comment).length};
}
function summarizeYear(records) {
 const days=new Map();for(const r of records){if(!days.has(r.date))days.set(r.date,[]);days.get(r.date).push(r);}
 const dayRows=[...days].sort(([a],[b])=>a.localeCompare(b)).map(([date,rr])=>({
  date,record_indices:rr.map(r=>r.index),...countSupport(rr),_interval:average(rr.map(r=>r.interval))}));
 const months=new Map();for(const d of dayRows){const m=d.date.slice(5,7);if(!months.has(m))months.set(m,[]);months.get(m).push(d);}
 const monthly=[...months].sort(([a],[b])=>a.localeCompare(b)).map(([month,ds])=>({
  month,sampling_dates:ds.map(d=>d.date),record_indices:ds.flatMap(d=>d.record_indices),
  sampled_days:ds.length,_interval:average(ds.map(d=>d._interval))}));
 return {records,dayRows,monthly,_interval:average(dayRows.map(d=>d._interval))};
}
export function analyze(rows, hash) {
 if(!Array.isArray(rows)||rows.length!==730||typeof hash!=="function")throw Error("Retain the complete 730 original result rows.");
 const seen=new Set(),groups=new Map(),calendar=new Map(),records=[];
 rows.forEach((row,index)=>{
  if(row.CharacteristicName!=="Escherichia coli"||row.ActivityMediaName!=="Water")
   throw Error("The original constituent or medium differs.");
  if(!row.ActivityIdentifier||!row.MonitoringLocationIdentifier||!/^\d{4}-\d{2}-\d{2}$/.test(row.ActivityStartDate))
   throw Error("An original station/activity/date is missing.");
  if(row.ActivityStartDate<"2021-01-01"||row.ActivityStartDate>"2025-12-31")throw Error("Original date is outside the retained period.");
  const nativeKey=jsonKey([row.OrganizationIdentifier,row.ActivityIdentifier]);
  if(seen.has(nativeKey))throw Error("Original organization/activity identity repeats.");seen.add(nativeKey);
  const original={index,combined_csv_row:index+2,source_file:row.source_file,source_row:Number(row.source_row),
   organization_id:row.OrganizationIdentifier,activity_id:row.ActivityIdentifier,
   station_id:row.MonitoringLocationIdentifier,date:row.ActivityStartDate,
   original_time:row["ActivityStartTime/Time"],original_time_zone:row["ActivityStartTime/TimeZoneCode"],
   original_activity_type:row.ActivityTypeCode,information_only_comment:informationOnly(row),
   original_comments:{result:row.ResultCommentText,laboratory:row.ResultLaboratoryCommentText,activity:row.ActivityCommentText},
   interval:interval(row),included:row.ActivityTypeCode==="Sample-Routine"};
  if(!Number.isInteger(original.source_row)||original.source_row<2)throw Error("Original CSV row locator is invalid.");
  if(original.included){
   const native=identity(row,SUPPORT),key=jsonKey(native),groupId="support-"+hash(key).slice(0,20);
   original.group_id=groupId;
   if(!groups.has(key))groups.set(key,{id:groupId,identity:native,records:[]});
   groups.get(key).records.push(original);
   const broad=identity(row,CALENDAR),broadKey=jsonKey(broad);
   if(!calendar.has(broadKey))calendar.set(broadKey,{identity:broad,records:[]});
   calendar.get(broadKey).records.push(original);
  }else original.exclusion="Original activity type retained separately from Sample-Routine";
  records.push(original);
 });
 const cohorts=[],comparisons=[];
 for(const group of [...groups.values()].sort((a,b)=>jsonKey(a.identity).localeCompare(jsonKey(b.identity)))){
  const years=new Map();for(const r of group.records){const y=r.date.slice(0,4);if(!years.has(y))years.set(y,[]);years.get(y).push(r);}
  const summaries=new Map([...years].sort(([a],[b])=>a.localeCompare(b)).map(([year,rr])=>[year,summarizeYear(rr)]));
  const cohort={id:group.id,identity:group.identity,years:[...summaries].map(([year,p])=>({
   year,...countSupport(p.records),sampled_days:p.dayRows.length,months:p.monthly.map(m=>m.month),
   sampled_day_mean:retainInterval(p._interval),
   days:p.dayRows.map(({_interval,...day})=>({...day,mean:retainInterval(_interval)})),
   monthly:p.monthly.map(({_interval,...month})=>({...month,mean:retainInterval(_interval)}))
  }))};
  cohorts.push(cohort);
  const yy=[...summaries.keys()];
  for(let i=0;i<yy.length;i++)for(let j=i+1;j<yy.length;j++){
   const before=summaries.get(yy[i]),after=summaries.get(yy[j]),bm=before.monthly.map(m=>m.month),
    am=after.monthly.map(m=>m.month),common=bm.filter(m=>am.includes(m));
   const beforeBalanced=average(common.map(m=>before.monthly.find(r=>r.month===m)._interval)),
    afterBalanced=average(common.map(m=>after.monthly.find(r=>r.month===m)._interval));
   const allChange=subtract(after._interval,before._interval),balancedChange=subtract(afterBalanced,beforeBalanced);
   const bc=before.records.filter(r=>common.includes(r.date.slice(5,7))),
    ac=after.records.filter(r=>common.includes(r.date.slice(5,7)));
   const allDirection=direction(allChange),balancedDirection=direction(balancedChange);
   comparisons.push({id:group.id+"-"+yy[i]+"-"+yy[j],group_id:group.id,
    station_id:group.identity.MonitoringLocationIdentifier,method_context:group.identity["ResultAnalyticalMethod/MethodIdentifierContext"],
    method:group.identity["ResultAnalyticalMethod/MethodIdentifier"],unit:group.identity.original_effective_unit,
    before_year:yy[i],after_year:yy[j],before_support:{...countSupport(before.records),sampled_days:before.dayRows.length,months:bm},
    after_support:{...countSupport(after.records),sampled_days:after.dayRows.length,months:am},
    identical_month_sets:jsonKey(bm)===jsonKey(am),common_months:common,
    before_sampled_day_mean:retainInterval(before._interval),after_sampled_day_mean:retainInterval(after._interval),
    sampled_day_change:retainInterval(allChange),sampled_day_direction:allDirection,
    common_month_before_mean:retainInterval(beforeBalanced),common_month_after_mean:retainInterval(afterBalanced),
    common_month_change:retainInterval(balancedChange),common_month_direction:balancedDirection,
    common_before_support:{...countSupport(bc),sampled_days:new Set(bc.map(r=>r.date)).size},
    common_after_support:{...countSupport(ac),sampled_days:new Set(ac.map(r=>r.date)).size},
    direction_reversal:["lower","higher"].includes(allDirection)&&["lower","higher"].includes(balancedDirection)&&allDirection!==balancedDirection
   });
  }
 }
 const calendarPairs=[];
 for(const g of calendar.values()){
  const years=[...new Set(g.records.map(r=>r.date.slice(0,4)))].sort();
  for(let i=0;i<years.length;i++)for(let j=i+1;j<years.length;j++){
   const before=g.records.filter(r=>r.date.startsWith(years[i])),after=g.records.filter(r=>r.date.startsWith(years[j])),
    bm=[...new Set(before.map(r=>r.date.slice(5,7)))].sort(),am=[...new Set(after.map(r=>r.date.slice(5,7)))].sort();
   calendarPairs.push({identity:g.identity,before_year:years[i],after_year:years[j],
    before_record_indices:before.map(r=>r.index),after_record_indices:after.map(r=>r.index),
    before_months:bm,after_months:am,common_months:bm.filter(m=>am.includes(m)),
    identical_month_sets:jsonKey(bm)===jsonKey(am),
    measurement_support_group_ids:[...new Set([...before,...after].map(r=>r.group_id))].sort()});
  }
 }
 const participating=new Set(cohorts.filter(g=>g.years.length>1).flatMap(g=>g.years.flatMap(y=>y.days.flatMap(d=>d.record_indices))));
 return {schema:VERSION,selection:{original_csv_sha256:SOURCE_SHA256,activity_type:"Sample-Routine",
  period:{start:"2021-01-01",end:"2025-12-31"},date_basis:"Unchanged publisher sample date; original clock and timezone retained, not converted.",
  physical_lower_bound:0,quantity:"Original sampled E. coli concentration",support_fields:SUPPORT,
  calendar_fields:CALENDAR,original_unit_policy:"Exact result unit, or exact limit unit for a censored row; spelling variants are separate.",
  qa_policy:"Original result-status and qualifier labels remain separate. Information Only comments are counted and preserved, not silently excluded.",
  weighting:"Equal original activities within a date; equal sampled dates within a month; equal common calendar months across each pair of years.",
  contrast:"Later sampled period minus earlier sampled period; no intervention/control or annual population trend inferred."},
  summary:{original_records:records.length,routine_records:records.filter(r=>r.included).length,
   nonroutine_records:records.filter(r=>!r.included).length,measurement_support_groups:cohorts.length,
   comparison_count:comparisons.length,comparison_record_count:participating.size,
   calendar_comparison_count:calendarPairs.length,calendar_identical_month_pairs:calendarPairs.filter(p=>p.identical_month_sets).length,
   measurement_identical_month_pairs:comparisons.filter(p=>p.identical_month_sets).length,
   reversals:comparisons.filter(p=>p.direction_reversal).length,
   information_only_records:records.filter(r=>r.information_only_comment).length,
   information_only_comparison_records:records.filter(r=>participating.has(r.index)&&r.information_only_comment).length},
  records:records.map(({interval,...r})=>({...r,interval:retainInterval(interval)})),
  cohorts,comparisons,calendar_pairs:calendarPairs};
}
export function intervalText(value) {
 if(!value)return "Unavailable";
 const n=v=>Object.is(v,-0)?"0":Number(v).toLocaleString("en-US",{maximumSignificantDigits:9,useGrouping:false});
 if(!value.lower_unbounded&&!value.upper_unbounded&&value.lower===value.upper)return n(value.lower);
 return (value.lower_unbounded||value.lower_open?"(":"[")+(value.lower_unbounded?"−∞":n(value.lower))+", "+
  (value.upper_unbounded?"+∞":n(value.upper))+(value.upper_unbounded||value.upper_open?")":"]");
}
export function comparisonCsv(value) {
 const rows=value.comparisons.map(p=>({comparison_id:p.id,group_id:p.group_id,station_id:p.station_id,
  method_context:p.method_context,method:p.method,original_unit:p.unit,before_year:p.before_year,after_year:p.after_year,
  before_records:p.before_support.records,after_records:p.after_support.records,before_sampled_days:p.before_support.sampled_days,
  after_sampled_days:p.after_support.sampled_days,before_months:p.before_support.months.join(" "),
  after_months:p.after_support.months.join(" "),common_months:p.common_months.join(" "),
  identical_month_sets:p.identical_month_sets,
  before_sampled_day_mean:intervalText(p.before_sampled_day_mean),after_sampled_day_mean:intervalText(p.after_sampled_day_mean),
  sampled_day_change:intervalText(p.sampled_day_change),sampled_day_direction:p.sampled_day_direction,
  common_month_before_mean:intervalText(p.common_month_before_mean),common_month_after_mean:intervalText(p.common_month_after_mean),
  common_month_change:intervalText(p.common_month_change),common_month_direction:p.common_month_direction,
  direction_reversal:p.direction_reversal,before_information_only:p.before_support.information_only_comments,
  after_information_only:p.after_support.information_only_comments}));
 const headers=Object.keys(rows[0]);const cell=v=>/[",\r\n]/.test(String(v))?'"'+String(v).replaceAll('"','""')+'"':String(v);
 return [headers,...rows.map(r=>headers.map(h=>r[h]))].map(r=>r.map(cell).join(",")).join("\n")+"\n";
}

export function reportRecipe(value, inputs) {
 const table=(columns,rows,caption)=>({kind:"table",columns,rows,caption});
 const pair=p=>p.before_year+" → "+p.after_year;
 const short=id=>id.replace(/^21SC60WQ_WQX-/,"").replace(/^21GAEPD_WQX-/,"");
 const counts=p=>p.before_support.records+"/"+p.before_support.sampled_days+" → "+p.after_support.records+"/"+p.after_support.sampled_days;
 const reversal=value.comparisons.filter(p=>p.direction_reversal);
 const allTable=rows=>table(["Station · years","Method / original unit","Records / sample days (earlier → later)",
  "All sampled-day change","Common-month change · months"],
  rows.map(p=>[short(p.station_id)+" · "+pair(p),p.method_context+" "+p.method+" / "+p.unit,counts(p),
   intervalText(p.sampled_day_change)+" · "+p.sampled_day_direction,
   intervalText(p.common_month_change)+" · "+p.common_month_direction+"; "+p.common_months.join(", ")]),
  "Changes are later minus earlier. Parentheses denote open bounds; ∞ denotes an unbounded endpoint. "
  +"Full-precision endpoints, all cohort fields and every original row locator remain in the JSON/CSV companions.");
 const recurring=value.cohorts.filter(g=>g.years.length>1);
 return {schema:"upstate.observed-report/v1",edition:VERSION,
  title:"Repeated-station E. coli — sampling-calendar and depth-aware comparisons, 2021–2025",
  sections:[
   ["What changes when the same sampled months are compared?",[
    "This chapter compares original routine E. coli observations at the same station and analytical method. "
    +"It describes sampled concentrations, not annual loads, compliance status, model validation or an intervention effect.",
    table(["Original support","Retained count"],Object.entries({
     "Original result rows":value.summary.original_records,"Routine rows":value.summary.routine_records,
     "Field replicate retained separately":value.summary.nonroutine_records,
     "Exact measurement-support groups":value.summary.measurement_support_groups,
     "Within-group year comparisons":value.summary.comparison_count,
     "Original routine rows occurring in comparisons":value.summary.comparison_record_count,
     "Publisher/calendar pairs with identical month sets":value.summary.calendar_identical_month_pairs,
     "Depth-aware measurement pairs with identical month sets":value.summary.measurement_identical_month_pairs,
     "Direction reversals under common-month weighting":value.summary.reversals
    })),
    "Four sampled-year comparisons reverse direction after restriction to shared calendar months and equal month weighting. "
    +"This identifies sensitivity to observed sampling support; it does not establish which estimate represents an annual population.",
    "The original calendar grouping has 17 identical-month pairs. Exact measurement support also retains recorded depth, "
    +"fraction, medium, value type, QA and collection method, producing 13 identical-month pairs. "
    +"A blank depth is not assigned the 0.3 m depth recorded on other samples."
   ]],
   ["Four actual direction reversals",[
    "These four comparisons use APHA 9223-B and original MPN/100mL units. Within each comparison, all exact measurement-support "
    +"fields match; sampling depth is unreported on the included rows. Source records with a declared depth remain separate.",
    allTable(reversal),
    table(["Station · years","Shared months","Earlier common support","Later common support"],
     reversal.map(p=>[short(p.station_id)+" · "+pair(p),p.common_months.join(", "),
      p.common_before_support.records+" rows / "+p.common_before_support.sampled_days+" days",
      p.common_after_support.records+" rows / "+p.common_after_support.sampled_days+" days"])),
    "The all-date SV-833 bounds remain unbounded where an original concentration exceeds its quantitation limit. "
    +"The bound itself supports the displayed direction; no upper-limit value was substituted for that sample."
   ]],
   ["All 17 original equal-calendar cases",[
    "This table reproduces calendar support using exact station, analytical-method context and identifier, routine activity type "
    +"and original effective unit. It does not pool concentrations across depth or other measurement-support groups.",
    table(["Station · years","Method / unit","Identical calendar months","Original rows (earlier → later)","Measurement groups retained"],
     value.calendar_pairs.filter(p=>p.identical_month_sets).map(p=>[
      short(p.identity.MonitoringLocationIdentifier)+" · "+pair(p),
      p.identity["ResultAnalyticalMethod/MethodIdentifierContext"]+" "+p.identity["ResultAnalyticalMethod/MethodIdentifier"]+" / "+p.identity.original_effective_unit,
      p.before_months.join(", "),p.before_record_indices.length+" → "+p.after_record_indices.length,p.measurement_support_group_ids.length])),
    "Matching a month name does not match sample dates, times, flow, weather or depth. The retained row locators allow those "
    +"original distinctions to be reviewed before a more specific comparison is selected."
   ]],
   ["Complete depth-aware year comparisons",[
    "All 115 available within-support comparisons are retained, including overlapping year pairs and intervals that span zero. "
    +"They are descriptive comparisons, not independent replications or a set of significance tests.",
    allTable(value.comparisons)
   ]],
   ["Original measurement groups and quality context",[
    table(["Station","Analytical method / unit","Original QA and value type","Available years"],
     recurring.map(g=>[g.identity.MonitoringLocationIdentifier,
      g.identity["ResultAnalyticalMethod/MethodIdentifierContext"]+" "+g.identity["ResultAnalyticalMethod/MethodIdentifier"]+" / "+g.identity.original_effective_unit,
      g.identity.ResultStatusIdentifier+" / "+g.identity.ResultValueTypeName+
       (g.identity.MeasureQualifierCode?" / "+g.identity.MeasureQualifierCode:" / no qualifier code supplied"),
      g.years.map(y=>y.year+" ("+y.records+" rows; "+y.sampled_days+" days)").join("; ")])),
    value.summary.information_only_records+" original rows carry an Information Only comment; "
    +value.summary.information_only_comparison_records+" of those original rows occur in the repeated-year measurement groups. "
    +"They remain included and flagged. This is an explicit all-routine source comparison, not a laboratory acceptance decision.",
    "The one Quality Control Sample-Field Replicate remains in the original CSV and retained record index, outside routine means. "
    +"Not Reported and ambiguous/missing limits never become zero, half a limit or a numeric measurement.",
    "All 49 support definitions, daily means, month means, original comments and row identities are available in the numeric companion."
   ]],
   ["Calculation and decision use",[
    "For one exact support group, all original routine activities on a publisher date receive equal weight in its daily interval mean. "
    +"Daily means receive equal weight in the all-sampled-day comparison. For common-month comparison, daily means first receive "
    +"equal weight within each month, then only month numbers observed in both years receive equal weight across years.",
    "The comparison is later minus earlier. For intervals, the lower difference is the later lower endpoint minus the earlier "
    +"upper endpoint; the upper difference is the later upper endpoint minus the earlier lower endpoint. An endpoint remains "
    +"open when a contributing endpoint is open. The source's nonnegative concentration floor is explicitly zero.",
    "A below-reporting or below-quantitation result is retained as [0, original limit). A result above its upper quantitation "
    +"limit is retained as (original limit, +∞). A reported number with no censor condition is a point. Unknown combinations "
    +"remain unresolved; a full-support mean is unavailable if any contributing interval is unresolved.",
    "Shared-month weighting answers a narrower sampled-calendar question. It cannot supply unmeasured months, adjust for "
    +"hydrology, remove reporting bias or estimate uncertainty. Neither full-date nor common-month mean is labeled an annual "
    +"time-weighted concentration or a native nutrient/sediment export.",
    "For Monitoring, use the original calendar and winter scenario to identify where more comparable seasonal observations "
    +"are needed. These results alone do not assign a new station, choose an intervention, establish a trend or alter programme costs."
   ]],
   ["Original source files and reproducible arithmetic",[
    {kind:"links",items:[
     {title:"Complete numerical result, support groups and original row index",path:"seasonal-comparison.json"},
     {title:"All 115 comparison rows",path:"seasonal-comparison.csv"},
     {title:"Original 730-result table with source file and row provenance",path:"results-with-provenance.csv"},
     {title:"Original source requests and response identities",path:"source-inputs.json"},
     {title:"Complete repeatable producer",path:"seasonal_comparison.mjs"},
     {title:"Method and same-project report continuation",path:"SEASONAL_COMPARISON.md"}
    ]},
    "The six original agency CSV responses are retained as companions. The producer checks each selected original row against "
    +"its unchanged response fields before calculation. Original dates, clock text, time zones, units, methods and source identifiers remain unchanged."
   ]]
  ],inputs,source_links:["seasonal-comparison.json","seasonal-comparison.csv","results-with-provenance.csv","source-inputs.json","SEASONAL_COMPARISON.md"],
  comparison_selection:value.selection,comparison_summary:value.summary};
}

function parseCSV(text){let rows=[],row=[],v="",q=false;for(let i=0;i<text.length;i++){let c=text[i];if(q){if(c==='"'){if(text[i+1]==='"'){v+='"';i++;}else q=false;}else v+=c;}else if(c==='"')q=true;else if(c===','){row.push(v);v="";}else if(c==='\n'){row.push(v);rows.push(row);row=[];v="";}else if(c!=='\r')v+=c;}if(q)throw Error("Unclosed quoted field");if(v!==""||row.length){row.push(v);rows.push(row);}const h=rows.shift();return rows.filter(x=>x.some(v=>v!=="")).map((x,i)=>{if(x.length!==h.length)throw Error("column count "+i);return Object.fromEntries(h.map((k,j)=>[k.replace(/^\uFEFF/,""),x[j]]));});}
const INPUTS = [
  {
    "path": "results-with-provenance.csv",
    "bytes": 368696,
    "sha256": "b6cf7d334c6b8bb1a174374c30e8ea3081dd1f05be2418040272c581a49264a8"
  },
  {
    "path": "raw/arjws-results-2021-2025-original.csv",
    "sha256": "5be1db109931d9e1ee8781b3beaab8db8ddbfc801a433d076de6de4eaa7372ef",
    "bytes": 68038
  },
  {
    "path": "raw/prwd-results-2021-original.csv",
    "sha256": "6cd6fb87b4746eff72cb88b4345d1cccb01133c953f5f281e77b92394896b93a",
    "bytes": 65619
  },
  {
    "path": "raw/prwd-results-2022-original.csv",
    "sha256": "acc3ae54de209755e9463fb82c3ca0f9d6237575b5b98f58f4690be12dc81e5c",
    "bytes": 39899
  },
  {
    "path": "raw/prwd-results-2023-original.csv",
    "sha256": "10eba1c5f8de5d00fe2bf156340978a8d85edbe991e0ce1413af34f24c70a0c3",
    "bytes": 44379
  },
  {
    "path": "raw/prwd-results-2024-original.csv",
    "sha256": "8f6dcdaf3cb59f1e363d73391c09efcca5a51a27c84e91eb528bf1129ba04c14",
    "bytes": 53715
  },
  {
    "path": "raw/prwd-results-2025-original.csv",
    "sha256": "6d1a0ccdda3dc49a67b636a202a80174a6dde5a15c4f8c3861cc45766b4747bc",
    "bytes": 73283
  },
  {
    "path": "source-inputs.json",
    "sha256": "1f12885711f3eb070de2e05f8db9f48c8578fe33c6bd20137b8959feb35b2a28",
    "bytes": 8181
  }
];

export function generate(texts, sourceCode, guide, hash, byteLength) {
 for(const expected of INPUTS) {
  const text=texts[expected.path];
  if(typeof text!=="string"||byteLength(text)!==expected.bytes||hash(text)!==expected.sha256)
   throw Error("Original source body changed: "+expected.path);
 }
 const rows=parseCSV(texts["results-with-provenance.csv"]);
 const originals=Object.fromEntries(INPUTS.filter(d=>d.path.startsWith("raw/")).map(d=>[d.path,parseCSV(texts[d.path])]));
 for(const row of rows) {
  const original=originals[row.source_file]?.[Number(row.source_row)-2];
  if(!original||Object.entries(original).some(([key,value])=>row[key]!==value)||
     Object.keys(row).some(key=>!["source_file","source_row","utility_id"].includes(key)&&!(key in original)))
   throw Error("Composed observation differs from its original response row: "+row.source_file+":"+row.source_row);
 }
 const value=analyze(rows,hash), outputs={
  "seasonal-comparison.json":JSON.stringify(value,null,2)+"\n",
  "seasonal-comparison.csv":comparisonCsv(value)
 };
 const retained={...texts,...outputs,"seasonal_comparison.mjs":sourceCode,"SEASONAL_COMPARISON.md":guide};
 const inputs=Object.entries(retained).map(([path,text])=>({path,bytes:byteLength(text),sha256:hash(text)})).sort((a,b)=>a.path.localeCompare(b.path));
 const recipe=reportRecipe(value,inputs);
 outputs["seasonal-comparison.recipe.json"]=JSON.stringify(recipe,null,2)+"\n";
 const manifest={schema:"upstate.sources/v1",title:recipe.title,captured_at:"2026-10-13",
  notes:["Original source rows remain unchanged. This chapter is descriptive sampled-calendar sensitivity, not a causal or annual-load estimate."],
  entries:[{id:"utility-ecoli-seasonal-comparison-20261013",title:recipe.title,kind:"document",role:"OBSERVED_CONTEXT",
   uri:"https://www.waterqualitydata.us/",vintage:"Original samples 2021–2025; retained source capture 2026-10-13",
   path:"seasonal-comparison.recipe.json",bytes:byteLength(outputs["seasonal-comparison.recipe.json"]),
   sha256:hash(outputs["seasonal-comparison.recipe.json"]),
   units:"Original MPN/100mL or MPN/100 ml; exact unit spellings remain separate",
   metadata:{report_schema:recipe.schema,analysis_schema:VERSION,original_csv_sha256:SOURCE_SHA256,
    source_counts:value.summary,scope:"Same station and exact measurement support; original routine sample dates"},
   companions:inputs}]};
 outputs["seasonal-comparison.sources.json"]=JSON.stringify(manifest,null,2)+"\n";
 return {outputs,summary:value.summary};
}

async function main() {
 const directory=dirname(fileURLToPath(import.meta.url)), texts={};
 for(const input of INPUTS)texts[input.path]=await readFile(resolve(directory,input.path),"utf8");
 const sourceCode=await readFile(fileURLToPath(import.meta.url),"utf8"),
  guide=await readFile(resolve(directory,"SEASONAL_COMPARISON.md"),"utf8"),
  hash=value=>createHash("sha256").update(value,"utf8").digest("hex");
 const result=generate(texts,sourceCode,guide,hash,value=>Buffer.byteLength(value,"utf8"));
 for(const [name,content]of Object.entries(result.outputs))await writeFile(resolve(directory,name),content,"utf8");
 process.stdout.write(JSON.stringify({schema:VERSION,summary:result.summary,
  outputs:Object.entries(result.outputs).map(([path,text])=>({path,bytes:Buffer.byteLength(text,"utf8"),sha256:hash(text)}))},null,2)+"\n");
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
 main().catch(error=>{process.stderr.write(error.stack+"\n");process.exitCode=1;});
}
