/** Retained 29-gauge calendar seasonality and flow-duration context.
 * Original daily decimal values, dates and source positions remain unchanged.
 */
const DAY=86400000,CFS_M3_DAY=0.028316846592*86400,SQMI_M2=2589988.110336;
export const SEASONS=[
 {id:"winter",label:"Winter (January, February and December of the calendar year)",months:[1,2,12]},
 {id:"spring",label:"Spring (March–May)",months:[3,4,5]},
 {id:"summer",label:"Summer (June–August)",months:[6,7,8]},
 {id:"autumn",label:"Autumn (September–November)",months:[9,10,11]}
];
const flags=value=>new Set(String(value||"").split(/[|;,:\s]+/).filter(Boolean));
const finite=value=>value!==""&&value!==null&&value!==undefined&&Number.isFinite(Number(value));
const q=(values,p)=>{if(!values.length)return null;const h=(values.length-1)*p,l=Math.floor(h),u=Math.ceil(h);return values[l]+(values[u]-values[l])*(h-l);};
const sorted=rows=>rows.map(r=>r.value).sort((a,b)=>a-b);
const exact=rows=>{
 let places=0;
 for(const row of rows){if(!/^\d+(\.\d+)?$/.test(row.reported))throw Error("Retain original nonnegative decimal flow");places=Math.max(places,(row.reported.split(".")[1]||"").length);}
 let numerator=0n;
 for(const row of rows){const [a,b=""]=row.reported.split(".");numerator+=BigInt(a+b.padEnd(places,"0"));}
 if(numerator>BigInt(Number.MAX_SAFE_INTEGER))throw Error("Original decimal sum needs a larger exact conversion");
 const raw=numerator.toString().padStart(places+1,"0");
 return {value:Number(numerator)/10**places,decimal:places?raw.slice(0,-places)+"."+raw.slice(-places):raw};
};
const mean=values=>values.length?values.reduce((a,b)=>a+b,0)/values.length:null;
const iso=value=>new Date(value).toISOString().slice(0,10);
const yearDates=year=>{const out=[];for(let d=Date.UTC(year,0,1);d<Date.UTC(year+1,0,1);d+=DAY)out.push(iso(d));return out;};
const dateRanges=dates=>{const out=[];for(const date of dates){const previous=out.at(-1);if(previous&&Date.parse(date)-Date.parse(previous.end)===DAY){previous.end=date;previous.days++;}else out.push({start:date,end:date,days:1});}return out;};
const position=row=>({date:row.date,reported_value:row.reported,qualifiers:row.qualifiers,
 source_id:row.source_id,source_values_index:row.values_index,source_record_index:row.record_index,source_line:row.source_line});
function period(rows,dates){
 const numeric=rows.filter(r=>r.value!==null),present=new Set(rows.map(r=>r.date));
 const sum=exact(numeric),n=numeric.length,expected=dates.length,values=sorted(numeric),part=code=>numeric.filter(r=>r.flags.has(code));
 const approved=part("A"),provisional=part("P"),estimated=part("e"),revised=part("R");
 const share=rs=>sum.value>0?exact(rs).value/sum.value:null;
 const absent=dates.filter(d=>!present.has(d)),nonnumeric=rows.filter(r=>r.value===null);
 const recordFlags={};for(const row of rows)recordFlags[row.qualifiers]=(recordFlags[row.qualifiers]||0)+1;
 return {expected_days:expected,record_days:rows.length,numeric_days:n,
  absent_days:absent.length,nonnumeric_days:nonnumeric.length,coverage_fraction:n/expected,
  complete_numeric:n===expected,fully_approved_complete:approved.length===expected,
  approved_numeric_days:approved.length,provisional_numeric_days:provisional.length,
  estimated_numeric_days:estimated.length,revised_numeric_days:revised.length,
  unclassified_numeric_days:numeric.filter(r=>!r.flags.has("A")&&!r.flags.has("P")).length,
  approved_record_days:rows.filter(r=>r.flags.has("A")).length,
  provisional_record_days:rows.filter(r=>r.flags.has("P")).length,
  original_flag_counts:recordFlags,
  exact_sum_daily_mean_cfs:n?sum.decimal:null,
  observed_mean_cfs:n?sum.value/n:null,observed_volume_m3:n?sum.value*CFS_M3_DAY:null,
  complete_volume_m3:n===expected?sum.value*CFS_M3_DAY:null,
  estimated_fraction_of_observed_volume:share(estimated),provisional_fraction_of_observed_volume:share(provisional),
  zero_flow_days:numeric.filter(r=>r.value===0).length,
  p05_observed_daily_cfs:q(values,.05),p10_observed_daily_cfs:q(values,.10),
  p25_observed_daily_cfs:q(values,.25),p50_observed_daily_cfs:q(values,.50),
  p75_observed_daily_cfs:q(values,.75),p90_observed_daily_cfs:q(values,.90),p95_observed_daily_cfs:q(values,.95),
  minimum_observed_cfs:values[0]??null,maximum_observed_cfs:values.at(-1)??null,
  absent_date_ranges:dateRanges(absent),nonnumeric_records:nonnumeric.map(position)};
}
const bounds=values=>{const a=values.filter(v=>v!==null).sort((x,y)=>x-y);return {count:a.length,minimum:a[0]??null,p25:q(a,.25),median:q(a,.5),p75:q(a,.75),maximum:a.at(-1)??null,mean:mean(a)};};
const same=(actual,expected,label)=>{if(actual!==expected)throw Error(label+": "+actual+" differs from "+expected);};
const close=(actual,expected,label)=>{if(!finite(expected)){if(actual!==null)throw Error(label+" has no original numeric counterpart");return;}if(actual===null||Math.abs(actual-Number(expected))>1e-10*Math.max(1,Math.abs(Number(expected))))throw Error(label+" differs from retained original aggregate");};
export function buildFlowSeasonality(payload){
 if(!payload||!Array.isArray(payload.annual)||!payload.series||!Array.isArray(payload.source_ids)||!Array.isArray(payload.sources))throw Error("Choose the complete retained flow-data payload");
 const sources=new Map(payload.sources.map(r=>[r.id,r]));same(sources.size,payload.sources.length,"Original source identities");
 const annual=[],monthly=[],seasonal=[],duration=[],positions=[],metadata=new Map(),knownSeries=new Set(),allRows=[];
 for(const original of payload.annual){
  const site=String(original.site),year=Number(String(original.period_start).slice(0,4)),key=site+"-"+year;
  if(!/^\d+$/.test(site)||!Number.isInteger(year)||original.period_start!==year+"-01-01"||original.period_end!==year+"-12-31"||String(original.parameter_code)!=="00060"||String(original.statistic_code)!=="00003")throw Error("Preserve the original calendar-year discharge selection");
  if(knownSeries.has(key))throw Error("Duplicate original gauge-year");knownSeries.add(key);
  const seenDates=new Set(),rows=(payload.series[key]||[]).map(raw=>{
   if(!Array.isArray(raw)||raw.length!==7)throw Error("Retain all original daily source-position fields");
   const [date,reported,qualifiers,index,values_index,record_index,source_line]=raw;
   if(typeof date!=="string"||date.slice(0,4)!==String(year)||iso(Date.parse(date+"T00:00:00Z"))!==date||seenDates.has(date))throw Error("Invalid or duplicate original gauge date");seenDates.add(date);
   if(typeof reported!=="string")throw Error("Preserve original decimal or nonnumeric agency spelling");
   const source_id=payload.source_ids[index];if(!Number.isInteger(index)||!sources.has(source_id))throw Error("Original daily source is missing");
   const value=/^\d+(\.\d+)?$/.test(reported)?Number(reported):null;
   if(value!==null&&!Number.isFinite(value))throw Error("Original discharge is nonfinite");
   for(const v of [values_index,record_index,source_line])if(v!==null&&(!Number.isInteger(v)||v<0))throw Error("Invalid original response position");
   return {site,year,date,reported,value,qualifiers:String(qualifiers??""),flags:flags(qualifiers),source_id,values_index,record_index,source_line};
  }).sort((a,b)=>a.date.localeCompare(b.date));
  allRows.push(...rows);const dates=yearDates(year),summary=period(rows,dates);
  same(summary.record_days,Number(original.record_days),key+" record coverage");
  same(summary.numeric_days,Number(original.valid_days),key+" numeric coverage");
  same(summary.expected_days,Number(original.expected_days),key+" calendar coverage");
  for(const [target,field]of [["approved_numeric_days","approved_days"],["provisional_numeric_days","provisional_days"],["estimated_numeric_days","estimated_days"],["revised_numeric_days","revised_days"]])same(summary[target],Number(original[field]),key+" "+field);
  close(summary.observed_mean_cfs,original.mean_cfs,key+" mean");close(summary.observed_volume_m3,original.observed_volume_m3,key+" volume");
  const numeric=rows.filter(r=>r.value!==null),values=sorted(numeric),p95=summary.p95_observed_daily_cfs,p10=summary.p10_observed_daily_cfs,sum=exact(numeric).value;
  const high=numeric.filter(r=>r.value>=p95),low=numeric.filter(r=>r.value<=p10);
  const area=finite(original.source_drainage_area_sqmi)?Number(original.source_drainage_area_sqmi):null;if(area!==null&&area<=0)throw Error("Original drainage area must be positive");
  const row={site,site_name:original.site_name,year,parameter_code:"00060",statistic_code:"00003",method_id:original.method_id,
   source_drainage_area_sqmi:area,...summary,
   complete_runoff_mm:summary.complete_volume_m3!==null&&area!==null?summary.complete_volume_m3/(area*SQMI_M2)*1000:null,
   days_at_or_above_observed_p95:high.length,
   fraction_of_observed_volume_at_or_above_p95:sum>0?exact(high).value/sum:null,
   days_at_or_below_observed_p10:low.length,
   fraction_of_observed_volume_at_or_below_p10:sum>0?exact(low).value/sum:null,
   observed_q5_to_q95_ratio:summary.p05_observed_daily_cfs>0?summary.p95_observed_daily_cfs/summary.p05_observed_daily_cfs:null,
   duration_q5_cfs:summary.p95_observed_daily_cfs,duration_q50_cfs:summary.p50_observed_daily_cfs,duration_q95_cfs:summary.p05_observed_daily_cfs,
   source_ids:[...new Set(rows.map(r=>r.source_id))].sort()};
  annual.push(row);if(!metadata.has(site))metadata.set(site,{site,site_name:original.site_name});
  for(let exceed=0;exceed<=100;exceed+=5)duration.push({site,site_name:original.site_name,year,exceedance_percent:exceed,
   observed_discharge_cfs:q(values,1-exceed/100),numeric_days:summary.numeric_days,expected_days:summary.expected_days,
   complete_numeric:summary.complete_numeric,fully_approved_complete:summary.fully_approved_complete});
  for(let month=1;month<=12;month++){
   const text=String(month).padStart(2,"0"),ds=dates.filter(d=>d.slice(5,7)===text),part=rows.filter(r=>r.date.slice(5,7)===text),m=period(part,ds);
   monthly.push({site,site_name:original.site_name,year,month,period_start:ds[0],period_end:ds.at(-1),...m,
    annual_complete_numeric:summary.complete_numeric,annual_fully_approved_complete:summary.fully_approved_complete,
    fraction_of_complete_annual_volume:summary.complete_numeric&&summary.complete_volume_m3>0?m.complete_volume_m3/summary.complete_volume_m3:null});
  }
  for(const season of SEASONS){
   const ds=dates.filter(d=>season.months.includes(Number(d.slice(5,7)))),part=rows.filter(r=>season.months.includes(Number(r.date.slice(5,7)))),v=period(part,ds);
   seasonal.push({site,site_name:original.site_name,year,season:season.id,season_label:season.label,calendar_months:season.months.join("|"),...v,
    annual_complete_numeric:summary.complete_numeric,annual_fully_approved_complete:summary.fully_approved_complete,
    fraction_of_complete_annual_volume:summary.complete_numeric&&summary.complete_volume_m3>0?v.complete_volume_m3/summary.complete_volume_m3:null});
  }
  positions.push({site,year,high_flow_threshold_inclusive_cfs:p95,high_flow_records:high.map(position),low_flow_threshold_inclusive_cfs:p10,low_flow_records:low.map(position),
   nonnumeric_records:summary.nonnumeric_records,absent_date_ranges:summary.absent_date_ranges});
 }
 for(const key of Object.keys(payload.series))if(!knownSeries.has(key))throw Error("Unselected original daily series");
 const monthlyProfile=[],seasonalProfile=[],stations=[],monthlyComparisons=[],seasonalComparisons=[];
 for(const meta of [...metadata.values()].sort((a,b)=>a.site.localeCompare(b.site))){
  const years=annual.filter(r=>r.site===meta.site),complete=years.filter(r=>r.complete_numeric),approved=complete.filter(r=>r.fully_approved_complete);
  const profile=(rows,field,value)=>{
   const actual=rows.filter(r=>r.site===meta.site&&r[field]===value&&r.annual_complete_numeric),strict=actual.filter(r=>r.annual_fully_approved_complete);
   const b=bounds(actual.map(r=>r.fraction_of_complete_annual_volume)),ab=bounds(strict.map(r=>r.fraction_of_complete_annual_volume));
   return {...meta,[field]:value,complete_years:actual.map(r=>r.year),fully_approved_years:strict.map(r=>r.year),
    complete_year_count:b.count,mean_annual_volume_fraction:b.mean,median_annual_volume_fraction:b.median,
    minimum_annual_volume_fraction:b.minimum,p25_annual_volume_fraction:b.p25,p75_annual_volume_fraction:b.p75,maximum_annual_volume_fraction:b.maximum,
    approved_year_count:ab.count,approved_mean_annual_volume_fraction:ab.mean,approved_median_annual_volume_fraction:ab.median};
  };
  for(let month=1;month<=12;month++)monthlyProfile.push(profile(monthly,"month",month));
  for(const season of SEASONS)seasonalProfile.push({...profile(seasonal,"season",season.id),season_label:season.label,calendar_months:season.months.join("|")});
  const high=bounds(complete.map(r=>r.fraction_of_observed_volume_at_or_above_p95)),ratio=bounds(complete.map(r=>r.observed_q5_to_q95_ratio));
  const peaks=monthlyProfile.filter(r=>r.site===meta.site&&r.mean_annual_volume_fraction!==null).sort((a,b)=>b.mean_annual_volume_fraction-a.mean_annual_volume_fraction||a.month-b.month);
  stations.push({...meta,retained_years:years.map(r=>r.year),complete_years:complete.map(r=>r.year),fully_approved_years:approved.map(r=>r.year),
   complete_year_count:complete.length,fully_approved_year_count:approved.length,record_days:years.reduce((s,r)=>s+r.record_days,0),
   numeric_days:years.reduce((s,r)=>s+r.numeric_days,0),expected_days:years.reduce((s,r)=>s+r.expected_days,0),
   provisional_numeric_days:years.reduce((s,r)=>s+r.provisional_numeric_days,0),estimated_numeric_days:years.reduce((s,r)=>s+r.estimated_numeric_days,0),
   peak_mean_fraction_month:peaks[0]?.month??null,peak_mean_fraction:peaks[0]?.mean_annual_volume_fraction??null,
   lowest_mean_fraction_month:peaks.at(-1)?.month??null,lowest_mean_fraction:peaks.at(-1)?.mean_annual_volume_fraction??null,
   median_complete_year_p95_volume_fraction:high.median,min_complete_year_p95_volume_fraction:high.minimum,max_complete_year_p95_volume_fraction:high.maximum,
   median_complete_year_q5_q95_ratio:ratio.median,minimum_complete_year_q5_q95_ratio:ratio.minimum,maximum_complete_year_q5_q95_ratio:ratio.maximum});
  const compare=(rows,field,values,output)=>{
   for(const year of years.map(r=>r.year))for(const value of values){
    const target=rows.find(r=>r.site===meta.site&&r.year===year&&r[field]===value);
    for(const reference_basis of ["complete_numeric","fully_approved_complete"]){
     const refs=rows.filter(r=>r.site===meta.site&&r.year!==year&&r[field]===value&&r[reference_basis]);
     const targetEligible=Boolean(target?.[reference_basis]);
     const annualField=reference_basis==="fully_approved_complete"?"annual_fully_approved_complete":"annual_complete_numeric";
     const fractionRefs=refs.filter(r=>r[annualField]&&r.fraction_of_complete_annual_volume!==null);
     const fractionEligible=targetEligible&&Boolean(target?.[annualField]);
     const fractions=bounds(fractionRefs.map(r=>r.fraction_of_complete_annual_volume)),means=bounds(refs.map(r=>r.observed_mean_cfs)),volumes=bounds(refs.map(r=>r.complete_volume_m3));
     output.push({...meta,[field]:value,year,reference_basis,reference_years:refs.map(r=>r.year),reference_year_count:refs.length,
      target_eligible:targetEligible,target_record_days:target?.record_days??0,target_numeric_days:target?.numeric_days??0,target_expected_days:target?.expected_days??0,
      target_coverage_fraction:target?.coverage_fraction??0,target_complete_numeric:Boolean(target?.complete_numeric),target_fully_approved_complete:Boolean(target?.fully_approved_complete),
      target_approved_numeric_days:target?.approved_numeric_days??0,target_estimated_numeric_days:target?.estimated_numeric_days??0,target_provisional_numeric_days:target?.provisional_numeric_days??0,target_revised_numeric_days:target?.revised_numeric_days??0,
      target_original_flag_counts:target?.original_flag_counts??{},
      target_observed_mean_cfs:target?.observed_mean_cfs??null,target_observed_volume_m3:target?.observed_volume_m3??null,target_complete_volume_m3:target?.complete_volume_m3??null,
      reference_median_period_mean_cfs:means.median,reference_minimum_period_mean_cfs:means.minimum,reference_maximum_period_mean_cfs:means.maximum,
      reference_median_period_volume_m3:volumes.median,reference_minimum_period_volume_m3:volumes.minimum,reference_maximum_period_volume_m3:volumes.maximum,
      target_to_reference_mean_ratio:targetEligible&&means.median>0?target.observed_mean_cfs/means.median:null,
      target_to_reference_volume_ratio:targetEligible&&volumes.median>0?target.complete_volume_m3/volumes.median:null,
      target_annual_complete_numeric:Boolean(target?.annual_complete_numeric),target_annual_fully_approved_complete:Boolean(target?.annual_fully_approved_complete),
      target_fraction_eligible:Boolean(fractionEligible),target_annual_volume_fraction:target?.fraction_of_complete_annual_volume??null,
      annual_fraction_reference_years:fractionRefs.map(r=>r.year),annual_fraction_reference_year_count:fractionRefs.length,
      reference_median_annual_volume_fraction:fractions.median,
      annual_volume_fraction_difference:fractionEligible&&fractions.median!==null?target.fraction_of_complete_annual_volume-fractions.median:null,
      reference_estimated_numeric_days:refs.reduce((n,r)=>n+r.estimated_numeric_days,0),reference_provisional_numeric_days:refs.reduce((n,r)=>n+r.provisional_numeric_days,0)});
    }
   }
  };
  compare(monthly,"month",Array.from({length:12},(_,i)=>i+1),monthlyComparisons);
  compare(seasonal,"season",SEASONS.map(r=>r.id),seasonalComparisons);
 }
 const summary={schema:"upstate.observed-flow-seasonality/v1",gauge_count:metadata.size,calendar_year_periods:annual.length,
  calendar_month_periods:monthly.length,calendar_season_periods:seasonal.length,daily_source_records:allRows.length,
  numeric_daily_records:allRows.filter(r=>r.value!==null).length,nonnumeric_daily_records:allRows.filter(r=>r.value===null).length,
  complete_numeric_years:annual.filter(r=>r.complete_numeric).length,fully_approved_complete_years:annual.filter(r=>r.fully_approved_complete).length,
  estimated_numeric_days:annual.reduce((s,r)=>s+r.estimated_numeric_days,0),provisional_numeric_days:annual.reduce((s,r)=>s+r.provisional_numeric_days,0),
  original_daily_source_count:new Set(allRows.map(r=>r.source_id)).size,
  complete_numeric_months:monthly.filter(r=>r.complete_numeric).length,
  complete_numeric_seasons:seasonal.filter(r=>r.complete_numeric).length,
  methods:{daily_volume:"Original decimal daily mean discharge summed exactly before multiplication by 0.028316846592 m3/ft3 and 86400 nominal seconds/day.",
   completeness:"Complete period volume requires every selected calendar date to contain a numeric original value. Observed-period volume retains only known days and is never annualized.",
   flags:"A and e may coexist. Approved, provisional, estimated and revised flags are separate preserved source attributes; record flags include nonnumeric observations.",
   seasons:"Winter is January, February and December of the same calendar year. Spring is March–May, summer June–August, autumn September–November. These disjoint month groups partition each complete calendar year.",
   fractions:"Annual fractions require a complete numeric calendar year and positive annual volume. Monthly/seasonal profile means weight each eligible complete year equally; separately retained fully approved profiles use only years with A on every numeric day.",
   duration:"Qp is the R-7 observed daily quantile at 1-p/100. Thus Q5 is P95 and Q95 is P05. Curves describe retained numeric days; incomplete years are explicitly labelled.",
   thresholds:"High-flow tail includes days at or above the observed P95; low-flow tail includes days at or below P10. Ties may make those day fractions exceed 5% or 10%. Full dated original positions are retained.",
   comparison:"Each selected-year comparison uses other complete calendar periods at the same gauge, independently of annual completeness, with separate complete-numeric and fully-approved reference choices. Mean ratios compare daily mean discharge; volume ratios also retain actual calendar length, including leap February. Annual-volume fraction comparisons use a separate complete-annual-year cohort. Missing target/reference support returns null.",
   scope:"Gauge discharge is hydrologic context. It is not a nutrient/sediment load or model calibration fit. Gauge volumes are not summed across stations; upstream/downstream catchments and regulated or diverted flows retain their own identities."}};
 return {summary,annual,monthly,seasonal,duration,monthlyProfile,seasonalProfile,stations,monthlyComparisons,seasonalComparisons,targetComparisons:seasonalComparisons.filter(r=>r.year===2023),positions,sources:payload.sources};
}
export function csv(rows){
 if(!rows.length)return "";
 const columns=[...new Set(rows.flatMap(row=>Object.keys(row)))];
 const cell=v=>{const s=v===null||v===undefined?"":typeof v==="object"?JSON.stringify(v):String(v);return /[",\r\n]/.test(s)?'"'+s.replaceAll('"','""')+'"':s;};
 return columns.join(",")+"\n"+rows.map(r=>columns.map(c=>cell(r[c])).join(",")).join("\n")+"\n";
}

export function compactFlowSeasonality(result){
 const table=(rows,exclude=[])=>{
  const columns=[...new Set(rows.flatMap(row=>Object.keys(row)))].filter(key=>!exclude.includes(key));
  return {columns,rows:rows.map(row=>columns.map(key=>row[key]??null))};
 };
 return {schema:"upstate.observed-flow-seasonality-explorer/v1",summary:result.summary,seasons:SEASONS,
  tables:{
   annual:table(result.annual,["site_name","nonnumeric_records"]),
   monthly:table(result.monthly,["site_name","nonnumeric_records"]),
   seasonal:table(result.seasonal,["site_name","nonnumeric_records"]),
   duration:table(result.duration,["site_name"]),
   monthlyProfile:table(result.monthlyProfile,["site_name"]),
   seasonalProfile:table(result.seasonalProfile,["site_name"]),
   stations:table(result.stations),
   monthlyComparisons:table(result.monthlyComparisons,["site_name","reference_periods"]),
   seasonalComparisons:table(result.seasonalComparisons,["site_name","reference_periods"])
  }};
}
