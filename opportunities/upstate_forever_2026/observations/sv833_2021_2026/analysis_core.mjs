// Original SV-833 agency result analysis; preserves source identities and reporting limits.
export function analyzeSV833(files,parseCsv,assessmentContext={},intervalTools) {
 const assert=(x,msg)=>{if(!x)throw Error(msg)},round=x=>x===null?null:Number(x.toFixed(12)),avg=a=>a.reduce((s,x)=>s+x,0)/a.length;
 const group=(a,key)=>{const m=new Map();for(const v of a){const k=key(v);if(!m.has(k))m.set(k,[]);m.get(k).push(v)}return m};
 const role=key=>{const f=files.find(f=>f.role===key);assert(f,"Missing original "+key);return f};
 const read=key=>{const f=role(key);return parseCsv(f.content).map((raw,i)=>({raw,source_path:f.path,source_sha256:f.sha256,source_data_row:i+1,source_uri:f.uri}))};
 const physical=read("physical_result_identifiers"),nutrients=read("nutrient_result_identifiers"),micro=read("microbiological_result_identifiers"),all=physical.concat(nutrients,micro);
 const activitiesOriginal=read("original_activities"),limitsOriginal=read("original_quantitation_limits"),stationRows=read("original_station_catalogue");
 const station=stationRows.find(s=>s.raw.MonitoringLocationIdentifier==="21SC60WQ_WQX-SV-833");assert(station,"Missing original station");
 const allFull=read("physical_results").concat(read("nutrient_results"),read("microbiological_results"));
 const byLimit=group(limitsOriginal,r=>r.raw.ResultIdentifier),byActivity=new Map(activitiesOriginal.map(r=>[r.raw.ActivityIdentifier,r]));
 const names={"Conductivity":["conductivity","umho/cm"],"Dissolved oxygen (DO)":["oxygen","mg/L"],"Temperature, water":["temperature","deg C"],"pH":["ph","None"],"Turbidity":["turbidity","NTU"],"Depth":["depth","m"],"Nitrate + Nitrite":["nox","mg/L"],"Ammonia":["ammonia","mg/L"],"Kjeldahl nitrogen":["tkn","mg/L"],"Phosphorus":["phosphorus","mg/L"],"Nitrogen":["agency_nitrogen","mg/L"],"Escherichia coli":["ecoli","MPN/100mL"]};
 assert(all.length===610&&new Set(all.map(o=>o.raw.ResultIdentifier)).size===610,"Original result identity changed");
 assert(activitiesOriginal.length===56&&limitsOriginal.length===606,"Original activity/limit census changed");
 const sharedFields=["ActivityIdentifier","ActivityStartDate","ActivityStartTime/Time","ActivityStartTime/TimeZoneCode","MonitoringLocationIdentifier","CharacteristicName","ResultDetectionConditionText","ResultMeasureValue","ResultMeasure/MeasureUnitCode","ResultSampleFractionText","ResultAnalyticalMethod/MethodIdentifier","ResultValueTypeName","ResultStatusIdentifier"];
 const records=all.map(o=>{
  const r=o.raw,meta=names[r.CharacteristicName];assert(meta,"Unknown characteristic "+r.CharacteristicName);const [analyte,unit]=meta;
  const a=byActivity.get(r.ActivityIdentifier);assert(a,"Missing activity "+r.ActivityIdentifier);
  for(const key of ["MonitoringLocationIdentifier","ActivityStartDate","ActivityStartTime/Time","ActivityStartTime/TimeZoneCode"])assert(a.raw[key]===r[key],"Activity metadata disagrees "+r.ResultIdentifier);
  assert(r.MonitoringLocationIdentifier==="21SC60WQ_WQX-SV-833"&&r.ResultStatusIdentifier==="Final","Wrong station/status");
  const limits=byLimit.get(r.ResultIdentifier)||[];
  for(const limit of limits)assert(limit.raw.ActivityIdentifier===r.ActivityIdentifier&&limit.raw.CharacteristicName===r.CharacteristicName,"Wrong original limit association");
  const below=r.ResultDetectionConditionText==="Present Below Quantification Limit",above=r.ResultDetectionConditionText==="Present Above Quantification Limit"&&r.ResultMeasureValue==="";
  const selected=limits.filter(l=>l.raw.DetectionQuantitationLimitTypeName===(below?"Lower Quantitation Limit":above?"Upper Quantitation Limit":""));
  let bound;
  if(below||above){assert(r.ResultMeasureValue===""&&selected.length===1,"Ambiguous original quantitation limit");assert(selected[0].raw["DetectionQuantitationLimitMeasure/MeasureUnitCode"]===unit,"Wrong limit unit");bound=Number(selected[0].raw["DetectionQuantitationLimitMeasure/MeasureValue"])}
  else {assert(r.ResultMeasureValue!==""&&r["ResultMeasure/MeasureUnitCode"]===unit,"Missing numerical value/unit");bound=Number(r.ResultMeasureValue)}
  assert(Number.isFinite(bound)&&bound>=0,"Invalid source number");
  const full=allFull.filter(f=>sharedFields.every(k=>f.raw[k]===r[k]));assert(full.length>=1,"Cross-profile original missing "+r.ResultIdentifier);
  const quality=analyte==="ph"&&(bound<0||bound>14)?"published pH outside study screening interval [0,14]":"";
  return {result_id:r.ResultIdentifier,activity:r.ActivityIdentifier,station:"SV-833",date:r.ActivityStartDate,time:r["ActivityStartTime/Time"],timezone:r["ActivityStartTime/TimeZoneCode"],project:a.raw.ProjectIdentifier,
    analyte,characteristic:r.CharacteristicName,unit,value_type:r.ResultValueTypeName,fraction:r.ResultSampleFractionText,speciation:r.MethodSpecificationName,method:r["ResultAnalyticalMethod/MethodIdentifier"],method_context:r["ResultAnalyticalMethod/MethodIdentifierContext"],
    reported_value:r.ResultMeasureValue,reported_unit:r["ResultMeasure/MeasureUnitCode"],condition:r.ResultDetectionConditionText,
    lower:below?0:bound,upper:above?null:bound,lower_open:above,upper_open:below||above,censoring:below?"below":above?"above":"none",quality_flag:quality,analysis_eligible:!quality,
    source_path:o.source_path,source_sha256:o.source_sha256,source_data_row:o.source_data_row,source_uri:o.source_uri,
    original_activity_path:a.source_path,original_activity_sha256:a.source_sha256,original_activity_row:a.source_data_row,
    limit_types:limits.map(l=>l.raw.DetectionQuantitationLimitTypeName).join(";"),limit_values:limits.map(l=>l.raw["DetectionQuantitationLimitMeasure/MeasureValue"]).join(";"),
    original_limit_ids:limits.map(l=>l.source_sha256+":"+l.source_data_row).join(";"),
    full_profile_selectors:full.map(f=>f.source_sha256+":"+f.source_data_row).join(";")};
 });
 const duplicates=[],measurements=[];
 for(const [key,rs] of group(records,r=>r.activity+"|"+r.analyte)){
  const first=rs[0],same=["date","time","timezone","unit","value_type","fraction","speciation","method","method_context","lower","upper","lower_open","upper_open","censoring","quality_flag","analysis_eligible"];
  for(const r of rs)for(const k of same)assert(r[k]===first[k],"Conflicting repeated original values "+key+" "+k);
  const m={activity:first.activity,station:first.station,date:first.date,time:first.time,timezone:first.timezone,project:first.project,analyte:first.analyte,characteristic:first.characteristic,unit:first.unit,
   lower:first.lower,upper:first.upper,lower_open:first.lower_open,upper_open:first.upper_open,censoring:first.censoring,value_type:first.value_type,speciation:first.speciation,fraction:first.fraction,method:first.method,
   quality_flag:first.quality_flag,analysis_eligible:first.analysis_eligible,result_count:rs.length,result_ids:rs.map(r=>r.result_id).sort().join(";"),original_selectors:rs.map(r=>r.source_sha256+":"+r.source_data_row).join(";")};
  measurements.push(m);
  if(rs.length>1)duplicates.push({...m,aggregation:"one equal value per original activity and characteristic; all original result IDs retained"});
 }
 const activities=activitiesOriginal.map(o=>{
  const a=o.raw,ms=Object.fromEntries(measurements.filter(m=>m.activity===a.ActivityIdentifier).map(m=>[m.analyte,m]));
  const t=ms.tkn,n=ms.nox;
  if(t&&n){assert(t.speciation==="as N"&&n.speciation==="as N"&&t.fraction==="Unfiltered"&&n.fraction==="Unfiltered","Incompatible original nitrogen components");
   assert(t.method==="10-107-06-2-E"&&n.method==="10-107-04-1-C","Incompatible nitrogen methods");
   ms.total_nitrogen={activity:a.ActivityIdentifier,station:"SV-833",date:a.ActivityStartDate,analyte:"total_nitrogen",characteristic:"Reconstructed total nitrogen",unit:"mg/L",speciation:"as N",fraction:"Unfiltered",
    lower:round(t.lower+n.lower),upper:round(t.upper+n.upper),lower_open:t.lower_open||n.lower_open,upper_open:t.upper_open||n.upper_open,censoring:t.censoring==="none"&&n.censoring==="none"?"none":"derived interval",analysis_eligible:true,quality_flag:"",
    result_ids:t.result_ids+";"+n.result_ids,result_count:t.result_count+n.result_count,original_selectors:t.original_selectors+";"+n.original_selectors};
  }
  return{activity:a.ActivityIdentifier,date:a.ActivityStartDate,time:a["ActivityStartTime/Time"],timezone:a["ActivityStartTime/TimeZoneCode"],project:a.ProjectIdentifier,year:Number(a.ActivityStartDate.slice(0,4)),month:Number(a.ActivityStartDate.slice(5,7)),original_depth:a["ActivityDepthHeightMeasure/MeasureValue"],original_depth_unit:a["ActivityDepthHeightMeasure/MeasureUnitCode"],source_path:o.source_path,source_sha256:o.source_sha256,source_data_row:o.source_data_row,measurements:ms};
 }).sort((a,b)=>a.date.localeCompare(b.date)||a.activity.localeCompare(b.activity));
 const medianEnd=(rs,key,open,side)=>{
  const number=r=>r[key]===null?(side==="lower"?-Infinity:Infinity):r[key];
  const ordered=[...rs].sort((a,b)=>number(a)-number(b)||(side==="lower"?Number(a[open])-Number(b[open]):Number(b[open])-Number(a[open])));
  const mids=[ordered[Math.floor((rs.length-1)/2)],ordered[Math.ceil((rs.length-1)/2)]],v=avg(mids.map(number));
  return {value:Number.isFinite(v)?round(v):null,open:mids.some(r=>r[open])||!Number.isFinite(v)};
 };
 const statistics=rs=>{const lo=medianEnd(rs,"lower","lower_open","lower"),hi=medianEnd(rs,"upper","upper_open","upper");
  return{n:rs.length,original_results:rs.reduce((s,r)=>s+r.result_count,0),below:rs.filter(r=>r.censoring==="below").length,above:rs.filter(r=>r.censoring==="above").length,censored:rs.filter(r=>r.censoring!=="none").length,
   mean_lower:round(avg(rs.map(r=>r.lower))),mean_upper:rs.some(r=>r.upper===null)?null:round(avg(rs.map(r=>r.upper))),mean_lower_open:rs.some(r=>r.lower_open),mean_upper_open:rs.some(r=>r.upper_open),
   median_lower:lo.value,median_upper:hi.value,median_lower_open:lo.open,median_upper_open:hi.open,min_lower:Math.min(...rs.map(r=>r.lower)),max_upper:rs.some(r=>r.upper===null)?null:Math.max(...rs.map(r=>r.upper))};
 };
 const summaries=[],analytes=[...Object.values(names).map(a=>a[0]),"total_nitrogen"];
 for(const scope of["all","year","season","assessment_overlap"]){
  const key=a=>scope==="all"?"all sampled dates":scope==="year"?String(a.year):scope==="season"?({12:"DJF",1:"DJF",2:"DJF",3:"MAM",4:"MAM",5:"MAM",6:"JJA",7:"JJA",8:"JJA",9:"SON",10:"SON",11:"SON"})[a.month]:a.year<=2022?"2021–2022 available overlap":"2023–2026 later observations";
  for(const [groupName,as]of group(activities,key))for(const k of analytes){const available=as.map(a=>a.measurements[k]).filter(Boolean),rs=available.filter(m=>m.analysis_eligible);if(!rs.length)continue;summaries.push({scope,group:groupName,analyte:k,unit:rs[0].unit,speciation:rs[0].speciation,available:available.length,quality_excluded:available.length-rs.length,...statistics(rs)})}
 }
 const rank=a=>a.map(v=>a.filter(x=>x<v).length+(a.filter(x=>x===v).length+1)/2);
 const corr=rs=>{const x=rank(rs.map(r=>r.x)),y=rank(rs.map(r=>r.y)),xm=avg(x),ym=avg(y),den=Math.sqrt(x.reduce((s,v)=>s+(v-xm)**2,0)*y.reduce((s,v)=>s+(v-ym)**2,0));return den?round(x.reduce((s,v,i)=>s+(v-xm)*(y[i]-ym),0)/den):null};
 const associations=[];
 for(const [x,y]of[["turbidity","ecoli"],["turbidity","phosphorus"],["turbidity","total_nitrogen"],["temperature","oxygen"],["ecoli","phosphorus"],["date","turbidity"]]){
  const available=activities.map(a=>({a,x:x==="date"?{lower:Date.parse(a.date+"T00:00:00Z"),upper:Date.parse(a.date+"T00:00:00Z"),analysis_eligible:true,lower_open:false,upper_open:false}:a.measurements[x],y:a.measurements[y]})).filter(r=>r.x&&r.y);
  const eligible=available.filter(r=>r.x.analysis_eligible&&r.y.analysis_eligible),exact=eligible.filter(r=>r.x.lower===r.x.upper&&r.y.lower===r.y.upper&&!r.x.lower_open&&!r.x.upper_open&&!r.y.lower_open&&!r.y.upper_open);
  const values=exact.map(r=>({x:r.x.lower,y:r.y.lower}));
  associations.push({x,y,available:available.length,eligible:eligible.length,exact_pairs:exact.length,censored_excluded:eligible.length-exact.length,spearman_rho:exact.length>=3?corr(values):null,selected_activity_ids:exact.map(r=>r.a.activity).join(";")});
 }
 const activityTable=activities.map(a=>{const row={activity:a.activity,date:a.date,time:a.time,timezone:a.timezone,project:a.project,year:a.year,month:a.month,original_depth:a.original_depth,original_depth_unit:a.original_depth_unit,activity_source_path:a.source_path,activity_source_sha256:a.source_sha256,activity_source_row:a.source_data_row};
  for(const key of analytes){const m=a.measurements[key];for(const field of["lower","upper","lower_open","upper_open","censoring","result_count","result_ids","quality_flag","analysis_eligible"])row[key+"_"+field]=m?m[field]??null:null}return row});
 const topTurbidity=[...activityTable].filter(a=>a.turbidity_lower!==null).sort((a,b)=>b.turbidity_lower-a.turbidity_lower||a.date.localeCompare(b.date)).slice(0,10);
 const quality=records.filter(r=>r.quality_flag);
 const agencyComparison=activities.filter(a=>a.measurements.agency_nitrogen).map(a=>({activity:a.activity,date:a.date,original_agency:a.measurements.agency_nitrogen.lower,original_type:a.measurements.agency_nitrogen.value_type,reconstructed_lower:a.measurements.total_nitrogen?.lower??null,reconstructed_upper:a.measurements.total_nitrogen?.upper??null,agency_result_ids:a.measurements.agency_nitrogen.result_ids,component_result_ids:a.measurements.total_nitrogen?.result_ids??""}));
 const yearlyCoverage=[...group(activities,a=>a.year)].map(([year,as])=>({year,activities:as.length,months:new Set(as.map(a=>a.month)).size,first_date:as[0].date,last_date:as.at(-1).date,physical_result_rows:records.filter(r=>Number(r.date.slice(0,4))===year&&["conductivity","oxygen","temperature","ph","turbidity","depth"].includes(r.analyte)).length,turbidity_activities:as.filter(a=>a.measurements.turbidity).length,ecoli_activities:as.filter(a=>a.measurements.ecoli).length,phosphorus_activities:as.filter(a=>a.measurements.phosphorus).length,tn_activities:as.filter(a=>a.measurements.total_nitrogen).length}));
 const summary=read("period_of_record_summary").filter(r=>Number(r.raw.YearSummarized)>=2021&&Number(r.raw.YearSummarized)<=2026);
 const sourceCensus=summary.map(s=>({year:Number(s.raw.YearSummarized),characteristic:s.raw.CharacteristicName,published_result_count:Number(s.raw.ResultCount),captured_result_count:records.filter(r=>Number(r.date.slice(0,4))===Number(s.raw.YearSummarized)&&r.characteristic===s.raw.CharacteristicName).length,summary_source_sha256:s.source_sha256,summary_source_row:s.source_data_row}));
 for(const row of sourceCensus)assert(row.published_result_count===row.captured_result_count,"Original physical source count differs");

 const weightingEffects=[];
 for(const [year,as]of group(activities,a=>a.year))for(const k of analytes){
   const activityValues=as.map(a=>a.measurements[k]).filter(m=>m&&m.analysis_eligible),rawValues=records.filter(r=>Number(r.date.slice(0,4))===year&&r.analyte===k&&r.analysis_eligible);
   if(!activityValues.length||rawValues.length<=activityValues.length)continue;
   const aStats=statistics(activityValues),rawStats=statistics(rawValues.map(v=>({...v,result_count:1})));
   weightingEffects.push({year,analyte:k,unit:activityValues[0].unit,activities:activityValues.length,original_result_rows:rawValues.length,
     activity_mean_lower:aStats.mean_lower,activity_mean_upper:aStats.mean_upper,activity_mean_lower_open:aStats.mean_lower_open,activity_mean_upper_open:aStats.mean_upper_open,
     raw_row_mean_lower:rawStats.mean_lower,raw_row_mean_upper:rawStats.mean_upper,raw_row_mean_lower_open:rawStats.mean_lower_open,raw_row_mean_upper_open:rawStats.mean_upper_open});
 }
 const influences=[];
 for(const k of analytes){
   const rows=activities.flatMap(a=>a.measurements[k]?.analysis_eligible?[{...a.measurements[k],activity:a.activity,date:a.date}]:[]);
   if(rows.length<10||rows.some(r=>r.upper===null))continue;
   const largest=[...rows].sort((a,b)=>b.upper-a.upper||a.date.localeCompare(b.date))[0],rest=rows.filter(r=>r!==largest),full=statistics(rows),without=statistics(rest);
   influences.push({analyte:k,unit:rows[0].unit,n:rows.length,largest_date:largest.date,largest_activity:largest.activity,largest_lower:largest.lower,largest_upper:largest.upper,largest_result_ids:largest.result_ids,
     full_mean_lower:full.mean_lower,full_mean_upper:full.mean_upper,full_mean_lower_open:full.mean_lower_open,full_mean_upper_open:full.mean_upper_open,
     full_median_lower:full.median_lower,full_median_upper:full.median_upper,full_median_lower_open:full.median_lower_open,full_median_upper_open:full.median_upper_open,
     without_mean_lower:without.mean_lower,without_mean_upper:without.mean_upper,without_mean_lower_open:without.mean_lower_open,without_mean_upper_open:without.mean_upper_open,remaining_n:rest.length,
     selection:"largest finite upper endpoint; full cohort retained"});
 }


 const intervalAssociations=[],intervalPairs=[];
 const asSupport=m=>({lo:m.lower,hi:m.upper,loOpen:m.lower_open,hiOpen:m.upper_open});
 for(const y of ["ecoli","phosphorus"]){
   const rows=activities.filter(a=>a.measurements.turbidity?.analysis_eligible&&a.measurements[y]?.analysis_eligible).map(a=>({
     activity:a.activity,date:a.date,x:asSupport(a.measurements.turbidity),y:asSupport(a.measurements[y])
   }));
   const classified=intervalTools.classifyPairedIntervals(rows);
   intervalAssociations.push({x:"turbidity",y,...classified.summary});
   intervalPairs.push(...classified.pairs.map(p=>({x:"turbidity",y,...p})));
 }
 const nitrogen2025=activities.filter(a=>a.year===2025&&a.measurements.total_nitrogen).map(a=>({activity:a.activity,...asSupport(a.measurements.total_nitrogen)}));
 const nitrogenInfluence2025=intervalTools.omissionInfluence(nitrogen2025,"21SC60WQ_WQX-AF33511");

 return{schema:"sv833.original-water-quality-study/v1",counts:{original_narrow_results:records.length,original_full_results:allFull.length,original_activity_records:activitiesOriginal.length,original_limit_records:limitsOriginal.length,distinct_result_ids:records.length,activity_characteristics:measurements.length,repeated_activity_characteristics:duplicates.length,additional_equal_results:records.length-measurements.length,activities:activities.length,dates:new Set(activities.map(a=>a.date)).size,ph_screened_records:quality.length,original_above_results:records.filter(r=>r.censoring==="above").length,original_below_results:records.filter(r=>r.censoring==="below").length},
  station,records,measurements,duplicates,activities,activity_table:activityTable,summaries,associations,top_turbidity:topTurbidity,quality_flags:quality,agency_nitrogen:agencyComparison,yearly_coverage:yearlyCoverage,source_census:sourceCensus,weighting_effects:weightingEffects,influences,interval_associations:intervalAssociations,interval_pairs:intervalPairs,nitrogen2025_influence:nitrogenInfluence2025,assessment_context:assessmentContext};
}
