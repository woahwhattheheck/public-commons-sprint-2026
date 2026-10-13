// Original-source nutrient and daily-flow analysis.
export function analyzeStreamNutrients({captures,catalogue,flowOriginals,basin},parseCsv) {
  const round=x=>Number(x.toFixed(12));
  const sum=a=>a.reduce((s,v)=>s+v,0);
  const avg=a=>a.length?sum(a)/a.length:null;
  const median=a=>{const b=[...a].sort((x,y)=>x-y);return b.length?(b[Math.floor((b.length-1)/2)]+b[Math.ceil((b.length-1)/2)])/2:null};
  const group=(rows,key)=>{const m=new Map();for(const r of rows){const k=key(r);if(!m.has(k))m.set(k,[]);m.get(k).push(r)}return m};
  const assert=(ok,msg)=>{if(!ok)throw Error(msg)};
  const records=captures.flatMap(c=>parseCsv(c.text).map((raw,i)=>{
    const below=raw.ResultDetectionConditionText==="Present Below Quantification Limit";
    const reported=raw.ResultMeasureValue;
    const unit=below?raw["DetectionQuantitationLimitMeasure/MeasureUnitCode"]:raw["ResultMeasure/MeasureUnitCode"];
    assert(unit==="mg/L","Unexpected concentration unit");
    assert(raw.ResultSampleFractionText==="Unfiltered","Unexpected sample fraction");
    assert(raw.ResultStatusIdentifier==="Final","Unexpected result status");
    assert(below?reported===""&&raw.DetectionQuantitationLimitTypeName==="Lower Quantitation Limit":raw.ResultDetectionConditionText===""&&reported!=="","Unexpected result/limit semantics");
    const value=below?Number(raw["DetectionQuantitationLimitMeasure/MeasureValue"]):Number(reported);
    assert(Number.isFinite(value)&&value>=0,"Invalid concentration");
    return {source_path:c.path,source_sha256:c.sha256,source_data_row:i+1,organization:raw.OrganizationIdentifier,
      activity:raw.ActivityIdentifier,station:raw.MonitoringLocationIdentifier.replace("21SC60WQ_WQX-",""),date:raw.ActivityStartDate,
      time:raw["ActivityStartTime/Time"],timezone:raw["ActivityStartTime/TimeZoneCode"],project:raw.ProjectIdentifier,
      depth:raw["ActivityDepthHeightMeasure/MeasureValue"],depth_unit:raw["ActivityDepthHeightMeasure/MeasureUnitCode"],
      characteristic:raw.CharacteristicName,fraction:raw.ResultSampleFractionText,reported,reported_unit:raw["ResultMeasure/MeasureUnitCode"],
      condition:raw.ResultDetectionConditionText,limit:raw["DetectionQuantitationLimitMeasure/MeasureValue"],
      limit_unit:raw["DetectionQuantitationLimitMeasure/MeasureUnitCode"],limit_type:raw.DetectionQuantitationLimitTypeName,
      value_type:raw.ResultValueTypeName,method:raw["ResultAnalyticalMethod/MethodIdentifier"],weight_basis:raw.ResultWeightBasisText,
      unit,unit_source:below?"original quantitation-limit unit":"original reported-result unit",lower:below?0:value,upper:value,
      upper_open:below,censored:below};
  }));
  assert(records.length===589,"Expected complete 589-record original cohort");
  const daily=flowOriginals.flatMap(c=>JSON.parse(c.text).value.timeSeries.flatMap((s,si)=>{
    const site=s.sourceInfo.siteCode[0].value,param=s.variable.variableCode[0].value;
    const stat=s.variable.options.option.find(o=>o.name==="Statistic")?.optionCode;
    assert(site==="02186702"&&param==="00060"&&stat==="00003"&&s.variable.unit.unitCode==="ft3/s","Incorrect gauge series");
    return s.values.flatMap((b,bi)=>b.value.map((v,ri)=>({date:v.dateTime.slice(0,10),datetime:v.dateTime,site,
      value:Number(v.value),reported:v.value,unit:"ft3/s",parameter:param,statistic:stat,
      method_ids:b.method.map(m=>m.methodID),qualifiers:v.qualifiers,source_path:c.path,source_sha256:c.sha256,
      series_index:si,block_index:bi,record_index:ri})));
  })).sort((a,b)=>a.date.localeCompare(b.date));
  assert(daily.length===2192&&new Set(daily.map(r=>r.date)).size===2192,"Daily series must cover 2192 unique days");
  assert(daily.every(r=>Number.isFinite(r.value)&&r.value>=0),"Invalid discharge");
  const byDay=new Map(daily.map(r=>[r.date,r])),byYear=group(daily,r=>r.date.slice(0,4));
  for(const d of daily){const year=byYear.get(d.date.slice(0,4));d.annual_flow_percentile=round(100*(year.filter(v=>v.value<d.value).length+year.filter(v=>v.value===d.value).length*.5)/year.length);
    d.annual_flow_quartile=Math.min(4,Math.floor(d.annual_flow_percentile/25)+1);
  }
  const activities=[...group(records,r=>r.activity)].map(([id,rs])=>{
    const base=rs[0];
    for(const k of ["station","date","time","timezone","project","depth","depth_unit"])assert(rs.every(r=>r[k]===base[k]),"Conflicting activity metadata "+id+" "+k);
    const get=name=>{const hit=rs.filter(r=>r.characteristic===name);assert(hit.length===1,"Expected one "+name+" per activity");return hit[0]};
    const tkn=get("Kjeldahl nitrogen"),nox=get("Nitrate + Nitrite"),p=get("Phosphorus");
    assert(tkn.value_type==="Actual"&&nox.value_type==="Actual","Unexpected TN component type");
    assert(tkn.method==="10-107-06-2-E"&&nox.method==="10-107-04-1-C","Unexpected TN method");
    const flow=byDay.get(base.date);assert(flow,"Missing same-date daily flow");
    const prior=daily.filter(d=>d.date<base.date&&Date.parse(base.date+"T00:00:00Z")-Date.parse(d.date+"T00:00:00Z")<=7*86400000);
    const agency=rs.find(r=>r.characteristic==="Nitrogen");
    return {activity:id,station:base.station,date:base.date,time:base.time,timezone:base.timezone,project:base.project,
      depth:base.depth,depth_unit:base.depth_unit,year:base.date.slice(0,4),
      season:({12:"DJF",1:"DJF",2:"DJF",3:"MAM",4:"MAM",5:"MAM",6:"JJA",7:"JJA",8:"JJA",9:"SON",10:"SON",11:"SON"})[Number(base.date.slice(5,7))],
      tn_lower:round(tkn.lower+nox.lower),tn_upper:round(tkn.upper+nox.upper),tn_upper_open:tkn.upper_open||nox.upper_open,
      tn_censored:tkn.censored||nox.censored,tn_unit:"mg/L as N; method-supported basis",tn_method:"same-activity unfiltered TKN + unfiltered nitrate/nitrite",
      tkn_lower:tkn.lower,tkn_upper:tkn.upper,tkn_upper_open:tkn.upper_open,nox_lower:nox.lower,nox_upper:nox.upper,nox_upper_open:nox.upper_open,
      phosphorus_lower:p.lower,phosphorus_upper:p.upper,phosphorus_upper_open:p.upper_open,
      source_tkn_path:tkn.source_path,source_tkn_sha256:tkn.source_sha256,source_tkn_row:tkn.source_data_row,
      source_nox_path:nox.source_path,source_nox_sha256:nox.source_sha256,source_nox_row:nox.source_data_row,
      source_p_path:p.source_path,source_p_sha256:p.source_sha256,source_p_row:p.source_data_row,
      agency_nitrogen_reported:agency?.reported??"",agency_nitrogen_value_type:agency?.value_type??"",
      agency_nitrogen_row:agency?.source_data_row??"",agency_nitrogen_method:agency?.method??"",
      flow_date:flow.date,flow_cfs:flow.value,flow_qualifiers:flow.qualifiers.join(";"),flow_percentile:flow.annual_flow_percentile,
      flow_quartile:flow.annual_flow_quartile,flow_source_path:flow.source_path,flow_source_sha256:flow.source_sha256,
      flow_source_record_index:flow.record_index,antecedent_7d_available:prior.length,
      antecedent_7d_mean_cfs:prior.length===7?round(avg(prior.map(r=>r.value))):null,
      antecedent_7d_max_cfs:prior.length===7?Math.max(...prior.map(r=>r.value)):null,
      antecedent_7d_qualifiers:[...new Set(prior.flatMap(r=>r.qualifiers))].sort().join(";")};
  }).sort((a,b)=>a.date.localeCompare(b.date)||a.station.localeCompare(b.station));
  assert(activities.length===153,"Expected 153 activities");
  assert(new Set(activities.map(a=>a.station+"|"+a.date)).size===activities.length,"Ambiguous same-date station activity");
  const medianOpen=(rs,hi,op)=>{const sorted=[...rs].sort((a,b)=>a[hi]-b[hi]||Number(b[op])-Number(a[op]));return sorted[Math.floor((sorted.length-1)/2)][op]||sorted[Math.ceil((sorted.length-1)/2)][op]};
  const intervalSummary=(rs,lo,hi,op)=>({n:rs.length,censored:rs.filter(r=>r[op]).length,
    mean_lower:round(avg(rs.map(r=>r[lo]))),mean_upper:round(avg(rs.map(r=>r[hi]))),
    upper_open:rs.some(r=>r[op]),median_lower:round(median(rs.map(r=>r[lo]))),median_upper:round(median(rs.map(r=>r[hi]))),median_upper_open:medianOpen(rs,hi,op)});
  const summary=[];
  for(const scope of ["station","station_year","station_season","station_flow_quartile"]){
    const key=r=>scope==="station"?r.station:scope==="station_year"?r.station+"|"+r.year:scope==="station_season"?r.station+"|"+r.season:r.station+"|Q"+r.flow_quartile;
    for(const [keyName,rs]of group(activities,key)){
      for(const [analyte,lo,hi,op]of[["Reconstructed total N","tn_lower","tn_upper","tn_upper_open"],["Phosphorus","phosphorus_lower","phosphorus_upper","phosphorus_upper_open"],["Nitrate + Nitrite","nox_lower","nox_upper","nox_upper_open"],["Kjeldahl nitrogen","tkn_lower","tkn_upper","tkn_upper_open"]]){
        summary.push({scope,group:keyName,station:rs[0].station,analyte,...intervalSummary(rs,lo,hi,op),date_first:rs[0].date,date_last:rs.at(-1).date,
          median_flow_cfs:round(median(rs.map(r=>r.flow_cfs))),flow_estimated:rs.filter(r=>r.flow_qualifiers.split(";").includes("e")).length,
          flow_provisional:rs.filter(r=>r.flow_qualifiers.split(";").includes("P")).length});
      }
    }
  }
  const comparison=[];
  for(const [date,rs]of group(activities,r=>r.date)){
    rs.sort((a,b)=>a.station.localeCompare(b.station));
    for(let i=0;i<rs.length;i++)for(let j=i+1;j<rs.length;j++){
      const a=rs[i],b=rs[j];
      for(const [analyte,lo,hi,op]of[["Reconstructed total N","tn_lower","tn_upper","tn_upper_open"],["Phosphorus","phosphorus_lower","phosphorus_upper","phosphorus_upper_open"]]){
        const lower=round(b[lo]-a[hi]),upper=round(b[hi]-a[lo]),lowerOpen=a[op],upperOpen=b[op];
        const higher=lower>0||lower===0&&lowerOpen,lowerThan=upper<0||upper===0&&upperOpen;
        const minutes=s=>s.split(":").reduce((n,v,i)=>n+Number(v)*[60,1,1/60][i],0);
        comparison.push({date,analyte,station_a:a.station,station_b:b.station,activity_a:a.activity,activity_b:b.activity,
          time_a:a.time,time_b:b.time,timezone_a:a.timezone,timezone_b:b.timezone,
          clock_separation_minutes:a.timezone===b.timezone?Math.abs(minutes(b.time)-minutes(a.time)):null,
          a_lower:a[lo],a_upper:a[hi],a_upper_open:a[op],b_lower:b[lo],b_upper:b[hi],b_upper_open:b[op],
          difference_b_minus_a_lower:lower,difference_b_minus_a_upper:upper,difference_lower_open:lowerOpen,difference_upper_open:upperOpen,
          direction:higher?"B higher":lowerThan?"B lower":lower===0&&upper===0?"equal":"unresolved by censor intervals",
          flow_cfs:a.flow_cfs,flow_qualifiers:a.flow_qualifiers,flow_percentile:a.flow_percentile});
      }
    }
  }
  const pairSummary=[...group(comparison,r=>r.station_a+"|"+r.station_b+"|"+r.analyte)].map(([key,rs])=>({
    station_a:rs[0].station_a,station_b:rs[0].station_b,analyte:rs[0].analyte,n:rs.length,
    b_higher:rs.filter(r=>r.direction==="B higher").length,b_lower:rs.filter(r=>r.direction==="B lower").length,
    equal:rs.filter(r=>r.direction==="equal").length,unresolved:rs.filter(r=>r.direction.startsWith("unresolved")).length,
    mean_difference_lower:round(avg(rs.map(r=>r.difference_b_minus_a_lower))),mean_difference_upper:round(avg(rs.map(r=>r.difference_b_minus_a_upper))),
    mean_difference_lower_open:rs.some(r=>r.difference_lower_open),mean_difference_upper_open:rs.some(r=>r.difference_upper_open),
    min_clock_separation_minutes:Math.min(...rs.filter(r=>r.clock_separation_minutes!==null).map(r=>r.clock_separation_minutes)),
    max_clock_separation_minutes:Math.max(...rs.filter(r=>r.clock_separation_minutes!==null).map(r=>r.clock_separation_minutes))}));
  const activityById=new Map(activities.map(a=>[a.activity,a]));
  const componentPairs=comparison.filter(p=>p.analyte==="Reconstructed total N").map(p=>{
    const a=activityById.get(p.activity_a),b=activityById.get(p.activity_b);
    const noxLow=round(b.nox_lower-a.nox_upper),noxHigh=round(b.nox_upper-a.nox_lower);
    const tknLow=round(b.tkn_lower-a.tkn_upper),tknHigh=round(b.tkn_upper-a.tkn_lower);
    assert(round(noxLow+tknLow)===p.difference_b_minus_a_lower&&round(noxHigh+tknHigh)===p.difference_b_minus_a_upper,"TN component identity differs");
    return {date:p.date,station_a:p.station_a,station_b:p.station_b,activity_a:p.activity_a,activity_b:p.activity_b,
      clock_separation_minutes:p.clock_separation_minutes,nox_difference_lower:noxLow,nox_difference_upper:noxHigh,
      tkn_difference_lower:tknLow,tkn_difference_upper:tknHigh,
      tkn_difference_lower_open:a.tkn_upper_open,tkn_difference_upper_open:b.tkn_upper_open,
      tn_difference_lower:p.difference_b_minus_a_lower,tn_difference_upper:p.difference_b_minus_a_upper};
  });
  const componentSummary=[...group(componentPairs,p=>p.station_a+"|"+p.station_b)].map(([key,rs])=>({
    station_a:rs[0].station_a,station_b:rs[0].station_b,n:rs.length,
    nox_b_higher:rs.filter(p=>p.nox_difference_lower>0).length,nox_b_lower:rs.filter(p=>p.nox_difference_upper<0).length,
    mean_nox_difference_lower:round(avg(rs.map(p=>p.nox_difference_lower))),
    mean_nox_difference_upper:round(avg(rs.map(p=>p.nox_difference_upper))),
    mean_tkn_difference_lower:round(avg(rs.map(p=>p.tkn_difference_lower))),
    mean_tkn_difference_upper:round(avg(rs.map(p=>p.tkn_difference_upper))),
    mean_tkn_difference_lower_open:rs.some(p=>p.tkn_difference_lower_open),
    mean_tkn_difference_upper_open:rs.some(p=>p.tkn_difference_upper_open)
  }));
  const agencyComparison=activities.filter(a=>a.agency_nitrogen_reported!=="").map(a=>({...a,
    agency_less_than_reconstructed_lower:Number(a.agency_nitrogen_reported)<a.tn_lower,
    agency_minus_reconstructed_lower:round(Number(a.agency_nitrogen_reported)-a.tn_lower),
    agency_minus_reconstructed_upper:round(Number(a.agency_nitrogen_reported)-a.tn_upper),
    agency_equals_tkn_upper:Number(a.agency_nitrogen_reported)===a.tkn_upper}));
  const flowCoverage=[...byYear].map(([year,rs])=>{
    const aa=activities.filter(a=>a.year===year),dates=[...new Set(aa.map(a=>a.date))],sample=dates.map(d=>byDay.get(d));
    return {year,daily_n:rs.length,annual_mean_cfs:round(avg(rs.map(r=>r.value))),annual_median_cfs:round(median(rs.map(r=>r.value))),
      annual_min_cfs:Math.min(...rs.map(r=>r.value)),annual_max_cfs:Math.max(...rs.map(r=>r.value)),
      sampled_dates:dates.length,activities:aa.length,sampled_median_cfs:round(median(sample.map(r=>r.value))),
      sampled_max_cfs:Math.max(...sample.map(r=>r.value)),sampled_flow_percentile_min:Math.min(...sample.map(r=>r.annual_flow_percentile)),
      sampled_flow_percentile_max:Math.max(...sample.map(r=>r.annual_flow_percentile)),
      top_decile_daily_days:rs.filter(r=>r.annual_flow_percentile>=90).length,top_decile_sampled_dates:sample.filter(r=>r.annual_flow_percentile>=90).length,
      original_estimated_days:rs.filter(r=>r.qualifiers.includes("e")).length,original_provisional_days:rs.filter(r=>r.qualifiers.includes("P")).length};
  });
  function withinRing(p,ring){let inside=false;for(let i=0,j=ring.length-1;i<ring.length;j=i++){const a=ring[i],b=ring[j];if((a[1]>p[1])!==(b[1]>p[1])&&p[0]<(b[0]-a[0])*(p[1]-a[1])/(b[1]-a[1])+a[0])inside=!inside}return inside}
  const polygons=basin.features.flatMap(f=>f.geometry.type==="Polygon"?[f.geometry.coordinates]:f.geometry.coordinates);
  const stations=parseCsv(catalogue).filter(r=>activities.some(a=>"21SC60WQ_WQX-"+a.station===r.MonitoringLocationIdentifier)).map(r=>{
    const p=[Number(r.LongitudeMeasure),Number(r.LatitudeMeasure)];return {station:r.MonitoringLocationName,description:r.MonitoringLocationDescriptionText,
      longitude:p[0],latitude:p[1],datum:r.HorizontalCoordinateReferenceSystemDatumName,
      inside_whole_catchment:polygons.some(poly=>withinRing(p,poly[0])&&!poly.slice(1).some(h=>withinRing(p,h))),
      activities:activities.filter(a=>"21SC60WQ_WQX-"+a.station===r.MonitoringLocationIdentifier).length,
      north_of_gauge:p[1]>34.645,gauge_relationship:"whole-catchment basin context; splitCatchment=false; upstream relationship requires network support"}});
  return {schema:"eighteenmile.stream-nutrient-analysis/v1",period:"2020-2025",counts:{original_results:records.length,activities:activities.length,
    numeric:records.filter(r=>!r.censored).length,below_quantitation:records.filter(r=>r.censored).length,
    depth_reported_activities:activities.filter(a=>a.depth!=="").length,original_agency_calculated_nitrogen:agencyComparison.length,
    reconstructed_tn_censored:activities.filter(a=>a.tn_censored).length,daily_flow:daily.length,paired_contrasts:comparison.length},
    records,activities,summaries:summary,paired_comparisons:comparison,pair_summaries:pairSummary,nitrogen_component_pairs:componentPairs,nitrogen_component_summary:componentSummary,
    agency_calculated_comparison:agencyComparison,flow_coverage:flowCoverage,stations,daily};
}
