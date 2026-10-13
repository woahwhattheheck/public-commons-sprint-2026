/** Sampling support for the maintained original RL-18151 study. */
export const deriveSamplingSupport = function deriveSamplingSupport(study, options={}){
 const records=study.records;
 if(!Array.isArray(records)||!records.length)throw Error("Use the complete executed original study");
 const dims=options.dimensions||["group","characteristic","fraction","unit","interval_unit","interval_unit_basis","sample_media","sample_media_subdivision","depth_value","depth_unit","depth_reference","result_depth_value","result_depth_unit","result_depth_reference","method_context","method_id","method_name","method_specification","result_value_type","temperature_basis","weight_basis","analytical_fraction"];
 const number=x=>typeof x==="number"&&Number.isFinite(x);
 const bound=r=>r.interval&&number(r.interval.lower)&&number(r.interval.upper)&&r.interval.lower<=r.interval.upper?{lo:r.interval.lower,hi:r.interval.upper,li:r.interval.lower_inclusive!==false,ui:r.interval.upper_inclusive!==false}:null;
 const identity=r=>({record_id:r.record_id,result_id:r.result_id||"",activity_id:r.activity_id,date:r.date,source_file:r.source_file,source_row:r.source_row,source_sha256:r.source_sha256});
 const same=x=>JSON.stringify(x);
 const sorted=x=>[...new Set(x)].sort();
 const meanBounds=items=>{
   if(!items.length||items.some(x=>!x))return null;
   return {lower:items.reduce((s,x)=>s+x.lo,0)/items.length,upper:items.reduce((s,x)=>s+x.hi,0)/items.length,lower_inclusive:items.every(x=>x.li),upper_inclusive:items.every(x=>x.ui)};
 };
 const summary=rs=>{
  const activityMap=new Map;for(const r of rs){if(!activityMap.has(r.activity_id))activityMap.set(r.activity_id,[]);activityMap.get(r.activity_id).push(r)}
  const activities=[...activityMap].sort(([a],[b])=>a.localeCompare(b)).map(([id,members])=>{
    const bb=members.map(bound),interval=meanBounds(bb);
    const sigs=sorted(members.map(r=>same([r.value_text,r.unit,r.interval?.status,r.interval?.lower,r.interval?.upper,r.interval?.lower_inclusive,r.interval?.upper_inclusive,r.interval?.unit,r.detection_condition])));
    const metadata=sorted(members.map(r=>same([r.limit_type,r.limit_value,r.limit_unit,r.qualifier,r.result_status])));
    return {activity_id:id,date:members[0].date,records:members.length,member_ids:members.map(identity),interval,repeat_status:members.length===1?"single_result":sigs.length===1?"agreeing_repeated_results":"differing_repeated_results",source_metadata_agreement:metadata.length===1,original_intervals:members.map(r=>({record_id:r.record_id,result_id:r.result_id||"",...r.interval,original_value:r.value_text,original_unit:r.unit,limit_type:r.limit_type,limit_value:r.limit_value,limit_unit:r.limit_unit}))};
  });
  const resultMean=meanBounds(rs.map(bound));
  const activityMean=meanBounds(activities.map(a=>a.interval?{lo:a.interval.lower,hi:a.interval.upper,li:a.interval.lower_inclusive,ui:a.interval.upper_inclusive}:null));
  let weightingDifference=null;
  if(resultMean&&activityMean){
    let lo=0,hi=0,li=true,ui=true;
    for(const r of rs){const c=1/(activities.length*activityMap.get(r.activity_id).length)-1/rs.length,b=bound(r);if(c>0){lo+=c*b.lo;hi+=c*b.hi;li&&=b.li;ui&&=b.ui}else if(c<0){lo+=c*b.hi;hi+=c*b.lo;li&&=b.ui;ui&&=b.li}}
    weightingDifference={lower:lo,upper:hi,lower_inclusive:li,upper_inclusive:ui,definition:"equal-activity mean minus result-weighted mean, preserving shared-record interval dependence"};
  }
  return {records:rs.length,activities:activities.length,dates:sorted(rs.map(r=>r.date)),censored_records:rs.filter(r=>r.interval?.status?.startsWith("left_censored")).length,unresolved_records:rs.filter(r=>!bound(r)).length,result_weighted_mean:resultMean,equal_activity_mean:activityMean,weighting_difference:weightingDifference,activity_rows:activities};
 };
 const cohorts=new Map;
 for(const r of records){
  if(!r.record_id||!r.activity_id||!/^\d{4}-\d{2}-\d{2}$/.test(r.date))throw Error("Original record lacks identity/date");
  const cohort={year:r.date.slice(0,4),...Object.fromEntries(dims.map(k=>[k,r[k]??""]))};const key=same(cohort);
  if(!cohorts.has(key))cohorts.set(key,{cohort,records:[]});cohorts.get(key).records.push(r);
 }
 const annual=[],leaveOneOut=[];
 for(const [index,{cohort,records:rs}] of [...cohorts.values()].sort((a,b)=>same(a.cohort).localeCompare(same(b.cohort))).entries()){
  const cohort_id="cohort-"+String(index+1).padStart(3,"0"),s=summary(rs);
  annual.push({cohort_id,...cohort,...s});
  if(s.activities>1)for(const activity of s.activity_rows){
    const remaining=rs.filter(r=>r.activity_id!==activity.activity_id),reduced=summary(remaining);
    leaveOneOut.push({cohort_id,removed_activity_id:activity.activity_id,removed_date:activity.date,removed_result_ids:activity.member_ids.map(x=>x.result_id||x.record_id),retained_records:reduced.records,retained_activities:reduced.activities,full_equal_activity_mean:s.equal_activity_mean,retained_equal_activity_mean:reduced.equal_activity_mean,retained_result_weighted_mean:reduced.result_weighted_mean});
  }
 }
 const start=options.start||study.summary?.selected_period?.start,end=options.end||study.summary?.selected_period?.end;
 if(!/^\d{4}-\d{2}-\d{2}$/.test(start||"")||!/^\d{4}-\d{2}-\d{2}$/.test(end||"")||start>end)throw Error("Exact capture window required");
 const groups=sorted(records.map(r=>r.group)),calendar=[];
 for(let y=Number(start.slice(0,4));y<=Number(end.slice(0,4));y++)for(let m=1;m<=12;m++){
 const month=String(y)+"-"+String(m).padStart(2,"0"),monthStart=month+"-01";
 const next=m===12?String(y+1)+"-01-01":String(y)+"-"+String(m+1).padStart(2,"0")+"-01";
 const monthEnd=new Date(Date.UTC(y,m,0)).toISOString().slice(0,10); const intersects=monthStart<=end&&next>start;if(!intersects)continue;
 for(const group of groups){const rs=records.filter(r=>r.group===group&&r.date.startsWith(month)),ids=sorted(rs.map(r=>r.activity_id));calendar.push({month,group,window_start:monthStart<start?start:monthStart,window_end:monthEnd>end?end:monthEnd,partial_query_month:monthStart<start||monthEnd>end,records:rs.length,activities:ids.length,sampling_dates:sorted(rs.map(r=>r.date)),activity_ids:ids,result_ids:rs.map(r=>r.result_id||r.record_id),state:rs.length?"returned_measurements":"no_returned_measurements"})}
 }
 const method={mean:"Within each exact year/cohort, average original result intervals within each ActivityIdentifier, then average those activity intervals with equal activity weight. Retain result-weighted means as a secondary description.",repeats:"No original result is discarded. Agreeing versus differing repeat status describes reported values, detection conditions and quantitative intervals within a cohort/activity. Source limit/qualifier/status metadata agreement is reported separately. Distinct identifiers remain distinct.",sensitivity:"Leave out one original sampling activity at a time within its exact year/cohort. Recompute equal-activity and result-weighted intervals from all retained rows. No resampling probabilities or statistical confidence interpretation.",bounds:"Intervals are inherited unchanged from the maintained study. A zero lower bound is the nonnegative mathematical bound, not an observed zero. Unresolved members prevent a complete-cohort mean.",calendar:"No-returned-measurements means no rows in these exact retained responses for that group and calendar month. It is not proof that no monitoring occurred elsewhere. No interpolated dates or unobserved values.",weighting:"The mean difference uses each same-record coefficient, preserving interval dependence rather than subtracting independent extrema."};
 return {schema:"upstate.rl18151-sampling-support/v1",station_id:study.summary.station_id,source_acquisition:study.summary.source_acquisition,selected_period:{start,end},method,dimensions:dims,records:records.length,activities:new Set(records.map(r=>r.activity_id)).size,cohorts:annual,leave_one_activity_out:leaveOneOut,calendar};
};

export const buildSamplingReview = function buildSamplingReview(study){
const source=deriveSamplingSupport(study);
const dimensions=["group","characteristic","fraction","quantitative_unit","sample_media","sample_media_subdivision","activity_type","depth_value","depth_unit","depth_reference","result_depth_value","result_depth_unit","result_depth_reference","method_context","method_id","method_name","method_specification","result_value_type","temperature_basis","weight_basis","time_basis","analytical_fraction","statistical_base","qualifier","result_status"];
const transformed=study.records.map(r=>({...r,quantitative_unit:r.interval?.unit||r.unit||"",time_basis:r.original?.ResultTimeBasisText||"",statistical_base:r.original?.StatisticalBaseCode||""}));
const compatible=deriveSamplingSupport({...study,records:transformed},{dimensions});
for(const cohort of compatible.cohorts){
 const members=transformed.filter(r=>r.date.startsWith(cohort.year)&&dimensions.every(k=>(r[k]??"")===cohort[k]));
 const reps=new Map;for(const r of members){const key=JSON.stringify([r.unit,r.interval_unit_basis]);if(!reps.has(key))reps.set(key,{original_unit:r.unit,interval_unit_basis:r.interval_unit_basis,records:0,record_ids:[]});const v=reps.get(key);v.records++;v.record_ids.push(r.record_id)}
 cohort.original_representations=[...reps.values()];
}
return {schema:"upstate.rl18151-sampling-review/v1",station_id:study.summary.station_id,source_acquisition:study.summary.source_acquisition,records:study.records.length,activities:new Set(study.records.map(r=>r.activity_id)).size,source_cohorts:source,compatible_measurement_cohorts:compatible,compatibility_rule:"Separate source cohorts remain unchanged. Compatible measurement summaries require exact agreement on selected year, characteristic, fraction, quantitative unit inherited from the maintained interval, chemical basis, medium, activity type, both sampling depths and references, analytical method/context/name, result basis, time/weight/temperature/particle basis, statistical base, qualifier and status. Original unit and interval-unit provenance are retained as complete member sets within every compatible cohort. No chemical conversion, missing-depth substitution or cross-year pooling is performed."};
};
