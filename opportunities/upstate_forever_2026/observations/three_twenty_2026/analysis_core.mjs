// Exact original agency rows -> activity-weighted, method-compatible observations.
export function analyzeThreeTwenty(files, parseCsv, window={start:"2026-01-01",end:"2026-10-13"}) {
 const check=(ok,msg)=>{if(!ok)throw Error(msg)}, round=x=>Number(x.toFixed(12));
 const group=(rows,key)=>{const m=new Map();for(const r of rows){const k=key(r);if(!m.has(k))m.set(k,[]);m.get(k).push(r)}return m};
 const read=role=>files.filter(f=>f.role===role).flatMap(f=>parseCsv(f.content).map((raw,i)=>({raw,source_path:f.path,source_sha256:f.sha256,source_data_row:i+1,source_uri:f.uri})));
 const inWindow=r=>r.ActivityStartDate>=window.start&&r.ActivityStartDate<=window.end;
 const originals=read("results").filter(o=>inWindow(o.raw)), activityOriginals=read("activities").filter(o=>inWindow(o.raw)), limitOriginals=read("limits");
 const byActivity=group(activityOriginals,o=>o.raw.ActivityIdentifier),byLimit=group(limitOriginals,o=>o.raw.ResultIdentifier);
 check(new Set(originals.map(o=>o.raw.ResultIdentifier)).size===originals.length,"Repeated source ResultIdentifier");
 const stations=files.filter(f=>f.role==="station").map(f=>{
  const rs=parseCsv(f.content).filter(r=>r.MonitoringLocationIdentifier==="21SC60WQ_WQX-"+f.station);check(rs.length===1,"Station identity "+f.station);
  const r=rs[0];check(r.HorizontalCoordinateReferenceSystemDatumName==="WGS84","Station CRS");
  return {station:f.station,identifier:r.MonitoringLocationIdentifier,description:r.MonitoringLocationDescriptionText,latitude:Number(r.LatitudeMeasure),longitude:Number(r.LongitudeMeasure),crs:r.HorizontalCoordinateReferenceSystemDatumName,source_path:f.path,source_sha256:f.sha256};
 }).sort((a,b)=>b.latitude-a.latitude);
 const stationOrder=new Map(stations.map((s,i)=>[s.station,i]));
 const supportFields=["CharacteristicName","MethodSpecificationName","ResultSampleFractionText","ResultAnalyticalMethod/MethodIdentifier","ResultAnalyticalMethod/MethodIdentifierContext","ResultValueTypeName","ResultStatusIdentifier","MeasureQualifierCode","ResultDepthHeightMeasure/MeasureValue","ResultDepthHeightMeasure/MeasureUnitCode","ResultDepthAltitudeReferencePointText","ResultSamplingPointName","ResultWeightBasisText","ResultTimeBasisText","ResultTemperatureBasisText","ResultParticleSizeBasisText","StatisticalBaseCode"];
 const records=originals.map(o=>{
  const r=o.raw,as=byActivity.get(r.ActivityIdentifier)||[];check(as.length===1,"Activity identity "+r.ActivityIdentifier);const a=as[0];
  for(const key of ["MonitoringLocationIdentifier","ActivityStartDate","ActivityStartTime/Time","ActivityStartTime/TimeZoneCode"])check(r[key]===a.raw[key],"Activity metadata differs "+r.ResultIdentifier);
  const limits=byLimit.get(r.ResultIdentifier)||[];
  for(const l of limits)for(const key of ["ActivityIdentifier","MonitoringLocationIdentifier","CharacteristicName"])check(l.raw[key]===r[key],"Limit association differs "+r.ResultIdentifier);
  const below=r.ResultDetectionConditionText==="Present Below Quantification Limit",above=r.ResultDetectionConditionText==="Present Above Quantification Limit";
  check(!r.ResultDetectionConditionText||below||above,"Unsupported detection condition "+r.ResultIdentifier);
  const selected=limits.filter(l=>l.raw.DetectionQuantitationLimitTypeName===(below?"Lower Quantitation Limit":above?"Upper Quantitation Limit":""));
  let value,unit=r["ResultMeasure/MeasureUnitCode"];
  if(below||above){check(r.ResultMeasureValue===""&&selected.length===1,"Ambiguous censor limit "+r.ResultIdentifier);value=Number(selected[0].raw["DetectionQuantitationLimitMeasure/MeasureValue"]);unit=selected[0].raw["DetectionQuantitationLimitMeasure/MeasureUnitCode"];check(value>=0&&unit,"Invalid censor bound");}
  else {check(r.ResultMeasureValue!==""&&unit,"Missing result value/unit "+r.ResultIdentifier);value=Number(r.ResultMeasureValue);}
  check(Number.isFinite(value),"Non-finite original value");const quality=[];
  if(r.ResultStatusIdentifier!=="Final")quality.push("non-final result");if(r.MeasureQualifierCode)quality.push("agency qualifier: "+r.MeasureQualifierCode);
  if(r.CharacteristicName==="pH"&&(value<0||value>14))quality.push("pH outside study screening interval [0,14]");
  if(a.raw.ActivityTypeCode!=="Sample-Routine"||a.raw.ActivityMediaName!=="Water")quality.push("outside routine water scope");
  const support=Object.fromEntries(supportFields.map(k=>[k,r[k]]));
  for(const k of ["ActivityTypeCode","ActivityMediaName","ActivityMediaSubdivisionName","ActivityDepthHeightMeasure/MeasureValue","ActivityDepthHeightMeasure/MeasureUnitCode","ActivityDepthAltitudeReferencePointText","ActivityRelativeDepthName"])support[k]=a.raw[k];
  support.unit=unit;
  return {result_id:r.ResultIdentifier,activity:r.ActivityIdentifier,station:r.MonitoringLocationIdentifier.replace("21SC60WQ_WQX-",""),date:r.ActivityStartDate,time:r["ActivityStartTime/Time"],timezone:r["ActivityStartTime/TimeZoneCode"],project:a.raw.ProjectIdentifier,characteristic:r.CharacteristicName,unit,method:r["ResultAnalyticalMethod/MethodIdentifier"],method_context:r["ResultAnalyticalMethod/MethodIdentifierContext"],fraction:r.ResultSampleFractionText,speciation:r.MethodSpecificationName,value_type:r.ResultValueTypeName,status:r.ResultStatusIdentifier,qualifier:r.MeasureQualifierCode,
   lower:below?0:value,upper:above?null:value,lower_open:above,upper_open:below||above,censoring:below?"below":above?"above":"none",reported_value:r.ResultMeasureValue,reported_unit:r["ResultMeasure/MeasureUnitCode"],condition:r.ResultDetectionConditionText,analysis_eligible:!quality.length,quality:quality.join(";"),support_key:JSON.stringify(support),
   source_path:o.source_path,source_sha256:o.source_sha256,source_data_row:o.source_data_row,source_uri:o.source_uri,activity_source_path:a.source_path,activity_source_sha256:a.source_sha256,activity_source_row:a.source_data_row,
   limit_selectors:limits.map(l=>l.source_sha256+":"+l.source_data_row).join(";"),limit_types:limits.map(l=>l.raw.DetectionQuantitationLimitTypeName).join(";"),limit_values:limits.map(l=>l.raw["DetectionQuantitationLimitMeasure/MeasureValue"]).join(";"),raw:r};
 });
 const measurements=[],duplicates=[];
 for(const [key,rs]of group(records,r=>r.activity+"|"+r.characteristic)){
  const f=rs[0],ignored=new Set(["ResultIdentifier","ResultDetectionQuantitationLimitUrl"]);
  for(const r of rs){for(const k of Object.keys(f.raw))if(!ignored.has(k))check(r.raw[k]===f.raw[k],"Conflicting repeated original field "+key+" "+k);
   for(const k of ["lower","upper","lower_open","upper_open","support_key","project","analysis_eligible"])check(r[k]===f[k],"Conflicting repeated support "+key+" "+k);}
  const {raw,result_id,source_path,source_sha256,source_data_row,source_uri,...rest}=f;
  const m={...rest,result_count:rs.length,result_ids:rs.map(r=>r.result_id).sort().join(";"),original_selectors:rs.map(r=>r.source_sha256+":"+r.source_data_row).join(";")};measurements.push(m);if(rs.length>1)duplicates.push(m);
 }
 measurements.sort((a,b)=>a.date.localeCompare(b.date)||a.time.localeCompare(b.time)||a.characteristic.localeCompare(b.characteristic));
 const activityGroups=group(measurements,m=>m.activity);
 const activities=[...activityGroups].map(([id,ms])=>{const a=byActivity.get(id)[0];return {activity:id,station:ms[0].station,date:ms[0].date,time:ms[0].time,timezone:ms[0].timezone,project:ms[0].project,original_results:ms.reduce((s,m)=>s+m.result_count,0),characteristics:ms.length,below:ms.filter(m=>m.censoring==="below").length,above:ms.filter(m=>m.censoring==="above").length,source_path:a.source_path,source_sha256:a.source_sha256,source_data_row:a.source_data_row};}).sort((a,b)=>a.date.localeCompare(b.date)||a.time.localeCompare(b.time));
 const medianEnd=(rs,key,open)=>{const a=[...rs].sort((x,y)=>(x[key]===null?Infinity:x[key])-(y[key]===null?Infinity:y[key])||(key==="lower"?Number(x[open])-Number(y[open]):Number(y[open])-Number(x[open])));const mids=[a[Math.floor((a.length-1)/2)],a[Math.ceil((a.length-1)/2)]];return {value:mids.some(r=>r[key]===null)?null:round(mids.reduce((s,r)=>s+r[key],0)/2),open:mids.some(r=>r[open])};};
 const stats=rs=>({n:rs.length,original_results:rs.reduce((s,r)=>s+r.result_count,0),below:rs.filter(r=>r.censoring==="below").length,above:rs.filter(r=>r.censoring==="above").length,
  mean_lower:round(rs.reduce((s,r)=>s+r.lower,0)/rs.length),mean_upper:rs.some(r=>r.upper===null)?null:round(rs.reduce((s,r)=>s+r.upper,0)/rs.length),mean_lower_open:rs.some(r=>r.lower_open),mean_upper_open:rs.some(r=>r.upper_open),
  median_lower:medianEnd(rs,"lower","lower_open").value,median_upper:medianEnd(rs,"upper","upper_open").value,median_lower_open:medianEnd(rs,"lower","lower_open").open,median_upper_open:medianEnd(rs,"upper","upper_open").open});
 const summaries=[...group(measurements.filter(m=>m.analysis_eligible),m=>m.station+"|"+m.support_key)].map(([,rs])=>({station:rs[0].station,characteristic:rs[0].characteristic,unit:rs[0].unit,method:rs[0].method,fraction:rs[0].fraction,speciation:rs[0].speciation,value_type:rs[0].value_type,first_date:rs[0].date,last_date:rs.at(-1).date,...stats(rs),activity_ids:rs.map(r=>r.activity).join(";")}));
 const coverage=stations.map(s=>{const as=activities.filter(a=>a.station===s.station),ms=measurements.filter(m=>m.station===s.station);return {station:s.station,activities:as.length,months:new Set(as.map(a=>a.date.slice(0,7))).size,first_date:as[0]?.date||"",last_date:as.at(-1)?.date||"",original_results:ms.reduce((n,m)=>n+m.result_count,0),measurements:ms.length,duplicates:ms.filter(m=>m.result_count>1).length,below:ms.filter(m=>m.censoring==="below").length,dates:as.map(a=>a.date).join(";"),projects:[...new Set(as.map(a=>a.project))].join(";")};});
 const clock=t=>{check(/^\d{2}:\d{2}:\d{2}$/.test(t),"Unsupported literal collection clock");const [h,m,s]=t.split(":").map(Number);return h*60+m+s/60};
 const datePairs=[],contrasts=[],pairCoverage=[];
 for(let i=0;i<stations.length;i++)for(let j=i+1;j<stations.length;j++){
  const sa=stations[i].station,sb=stations[j].station,aa=activities.filter(a=>a.station===sa),bb=activities.filter(a=>a.station===sb);
  let matching=0;
  for(const a of aa)for(const b of bb)if(a.date===b.date){
   matching++;check(a.timezone===b.timezone,"Cannot compare different clock zones");const timeGap=round(clock(b.time)-clock(a.time));
   const sameProject=a.project===b.project;
   const pair={station_a:sa,station_b:sb,date:a.date,activity_a:a.activity,activity_b:b.activity,time_a:a.time,time_b:b.time,timezone:a.timezone,minutes_b_minus_a:timeGap,project_a:a.project,project_b:b.project,same_project:sameProject};datePairs.push(pair);
   for(const x of activityGroups.get(a.activity))for(const y of activityGroups.get(b.activity))if(x.characteristic===y.characteristic){
    const compatible=x.support_key===y.support_key&&x.analysis_eligible&&y.analysis_eligible;
    const lo=y.lower-(x.upper===null?Infinity:x.upper),hi=(y.upper===null?Infinity:y.upper)-x.lower;
    contrasts.push({...pair,characteristic:x.characteristic,unit:x.unit,method_a:x.method,method_b:y.method,fraction_a:x.fraction,fraction_b:y.fraction,speciation_a:x.speciation,speciation_b:y.speciation,compatible,comparison_scope:sameProject?"same-day same-project descriptive contrast":"same-day different-project descriptive contrast",
     a_lower:x.lower,a_upper:x.upper,a_lower_open:x.lower_open,a_upper_open:x.upper_open,b_lower:y.lower,b_upper:y.upper,b_lower_open:y.lower_open,b_upper_open:y.upper_open,
     b_minus_a_lower:compatible&&Number.isFinite(lo)?round(lo):null,b_minus_a_upper:compatible&&Number.isFinite(hi)?round(hi):null,difference_lower_open:y.lower_open||x.upper_open,difference_upper_open:y.upper_open||x.lower_open,
     result_ids_a:x.result_ids,result_ids_b:y.result_ids,source_selectors_a:x.original_selectors,source_selectors_b:y.original_selectors});
   }
  }
  const gaps=aa.flatMap(a=>bb.map(b=>({a:a.date,b:b.date,days:Math.abs(Date.parse(a.date+"T00:00:00Z")-Date.parse(b.date+"T00:00:00Z"))/86400000}))).sort((a,b)=>a.days-b.days||a.a.localeCompare(b.a)||a.b.localeCompare(b.b));
  pairCoverage.push({station_a:sa,station_b:sb,activities_a:aa.length,activities_b:bb.length,shared_dates:matching,nearest_gap_days:gaps[0]?.days??null,nearest_date_a:gaps[0]?.a||"",nearest_date_b:gaps[0]?.b||""});
 }
 const nitrogen=[];
 for(const a of activities){const ms=activityGroups.get(a.activity),t=ms.find(m=>m.characteristic==="Kjeldahl nitrogen"),n=ms.find(m=>m.characteristic==="Nitrate + Nitrite");
  if(!t||!n)continue;check(t.unit==="mg/L"&&n.unit==="mg/L"&&t.speciation==="as N"&&n.speciation==="as N"&&t.fraction==="Unfiltered"&&n.fraction==="Unfiltered","Nitrogen component support");
  check(t.method==="10-107-06-2-E"&&n.method==="10-107-04-1-C","Nitrogen component methods");
  nitrogen.push({station:a.station,activity:a.activity,date:a.date,time:a.time,timezone:a.timezone,project:a.project,unit:"mg/L as N",lower:round(t.lower+n.lower),upper:t.upper===null||n.upper===null?null:round(t.upper+n.upper),lower_open:t.lower_open||n.lower_open,upper_open:t.upper_open||n.upper_open,tkn_result_ids:t.result_ids,nox_result_ids:n.result_ids,component_selectors:t.original_selectors+";"+n.original_selectors});
 }
 return {schema:"three-twenty.original-multistation-study/v1",window,counts:{original_results:records.length,distinct_result_ids:records.length,activities:activities.length,dates:new Set(activities.map(a=>a.date)).size,stations:stations.length,measurements:measurements.length,duplicate_groups:duplicates.length,additional_equal_results:records.length-measurements.length,same_day_station_pairs:datePairs.length,compatible_same_day_contrasts:contrasts.filter(c=>c.compatible).length,below_measurements:measurements.filter(m=>m.censoring==="below").length},stations,records,measurements,duplicates,activities,summaries,coverage,date_pairs:datePairs,contrasts,pair_coverage:pairCoverage,nitrogen};
}
