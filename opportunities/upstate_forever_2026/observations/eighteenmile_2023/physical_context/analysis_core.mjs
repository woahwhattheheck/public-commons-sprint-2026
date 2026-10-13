function analyzePhysicalContext(captures,flowSource,parseCsv) {
  const round=v=>v===null?null:Number(v.toFixed(12));
  const avg=values=>values.length?values.reduce((a,b)=>a+b,0)/values.length:null;
  const median=values=>{const a=[...values].sort((x,y)=>x-y);return a.length?(a[Math.floor((a.length-1)/2)]+a[Math.ceil((a.length-1)/2)])/2:null};
  const group=(rs,key)=>{const m=new Map();for(const r of rs){const k=key(r);if(!m.has(k))m.set(k,[]);m.get(k).push(r)}return m};
  const assert=(ok,msg)=>{if(!ok)throw Error(msg)};
  const names={"Temperature, water":["temperature","deg C"],"Dissolved oxygen (DO)":["oxygen","mg/L"],"Turbidity":["turbidity","NTU"],
    "Biochemical oxygen demand, standard conditions":["bod","mg/L"],"Escherichia coli":["ecoli","MPN/100mL"],
    "Total suspended solids":["tss","mg/L"],"Depth":["measured_depth","m"],"Depth, Secchi disk depth":["secchi","m"],
    "Kjeldahl nitrogen":["tkn","mg/L"],"Nitrate + Nitrite":["nox","mg/L"],"Phosphorus":["phosphorus","mg/L"],
    "Ammonia":["ammonia","mg/L"],"Alkalinity, total":["alkalinity","mg/L"]};
  const physical=new Set(["temperature","oxygen","turbidity","bod","ecoli","tss","measured_depth","secchi"]);
  const originals=captures.flatMap(c=>parseCsv(c.text).map((raw,i)=>({raw,source_path:c.source_path,source_sha256:c.sha256,source_uri:c.source_url,data_row:i+1})));
  const records=originals.filter(o=>names[o.raw.CharacteristicName]).map(o=>{
    const r=o.raw,[analyte,expectedUnit]=names[r.CharacteristicName],condition=r.ResultDetectionConditionText,value=r.ResultMeasureValue;
    const limitType=r.DetectionQuantitationLimitTypeName,limitText=r["DetectionQuantitationLimitMeasure/MeasureValue"];
    const below=condition==="Present Below Quantification Limit",above=condition==="Present Above Quantification Limit"&&value===""&&limitType==="Upper Quantitation Limit";
    const censored=below||above,unit=censored?r["DetectionQuantitationLimitMeasure/MeasureUnitCode"]:r["ResultMeasure/MeasureUnitCode"];
    assert(unit===expectedUnit,"Unexpected unit "+unit+" for "+analyte);
    assert(censored?value===""&&limitText!=="":value!=="","Inconsistent original measurement/limit");
    assert(!below||limitType==="Lower Quantitation Limit","Unexpected lower-limit metadata");
    assert(censored||condition===""||condition==="Present Above Quantification Limit","Unexpected reported condition");
    const bound=Number(censored?limitText:value);assert(Number.isFinite(bound)&&bound>=0,"Invalid physical measurement");
    return {record_id:o.source_sha256+":"+o.data_row,source_path:o.source_path,source_sha256:o.source_sha256,source_uri:o.source_uri,source_data_row:o.data_row,
      activity:r.ActivityIdentifier,station:r.MonitoringLocationIdentifier.replace("21SC60WQ_WQX-",""),date:r.ActivityStartDate,
      time:r["ActivityStartTime/Time"],timezone:r["ActivityStartTime/TimeZoneCode"],project:r.ProjectIdentifier,
      activity_type:r.ActivityTypeCode,media:r.ActivityMediaName,activity_depth:r["ActivityDepthHeightMeasure/MeasureValue"],
      activity_depth_unit:r["ActivityDepthHeightMeasure/MeasureUnitCode"],result_depth:r["ResultDepthHeightMeasure/MeasureValue"],
      result_depth_unit:r["ResultDepthHeightMeasure/MeasureUnitCode"],analyte,characteristic:r.CharacteristicName,
      reported_value:value,reported_unit:r["ResultMeasure/MeasureUnitCode"],condition,limit:limitText,
      limit_unit:r["DetectionQuantitationLimitMeasure/MeasureUnitCode"],limit_type:limitType,unit,
      fraction:r.ResultSampleFractionText,method:r["ResultAnalyticalMethod/MethodIdentifier"],value_type:r.ResultValueTypeName,
      lower:below?0:bound,upper:above?null:bound,lower_open:above,upper_open:below||above,
      censoring:below?"below":above?"above":"none"};
  });
  const daily=JSON.parse(flowSource.text).value.timeSeries.flatMap((s,si)=>{
    assert(s.sourceInfo.siteCode[0].value==="02186702"&&s.variable.variableCode[0].value==="00060"&&s.variable.options.option.some(o=>o.name==="Statistic"&&o.optionCode==="00003"),"Wrong daily reference series");
    return s.values.flatMap((b,bi)=>b.value.map((v,ri)=>({date:v.dateTime.slice(0,10),flow_cfs:Number(v.value),qualifiers:v.qualifiers.join(";"),
      source_path:flowSource.source_path,source_sha256:flowSource.sha256,series_index:si,block_index:bi,record_index:ri})));
  });
  assert(daily.length===365&&new Set(daily.map(d=>d.date)).size===365,"Expected complete2023daily flow");
  for(const d of daily)d.percentile=round(100*(daily.filter(v=>v.flow_cfs<d.flow_cfs).length+.5*daily.filter(v=>v.flow_cfs===d.flow_cfs).length)/daily.length);
  const byDate=new Map(daily.map(d=>[d.date,d]));
  const byActivity=group(records,r=>r.activity);
  const activities=[...byActivity].filter(([id,rs])=>rs.some(r=>physical.has(r.analyte))).map(([activity,rs])=>{
    const a=rs[0],measurements={};
    for(const r of rs){assert(!measurements[r.analyte],"Duplicate analyte in activity");for(const k of["station","date","time","timezone","project"])assert(r[k]===a[k],"Inconsistent activity "+activity);measurements[r.analyte]=r}
    const tkn=measurements.tkn,nox=measurements.nox;
    if(tkn&&nox){assert(tkn.fraction==="Unfiltered"&&nox.fraction==="Unfiltered"&&tkn.method==="10-107-06-2-E"&&nox.method==="10-107-04-1-C","Incompatible N components");
      measurements.total_nitrogen={analyte:"total_nitrogen",characteristic:"Reconstructed total nitrogen",unit:"mg/L",lower:round(tkn.lower+nox.lower),
      upper:tkn.upper===null||nox.upper===null?null:round(tkn.upper+nox.upper),lower_open:tkn.lower_open||nox.lower_open,
      upper_open:tkn.upper_open||nox.upper_open,censoring:tkn.censoring==="none"&&nox.censoring==="none"?"none":"derived interval",
      record_id:tkn.record_id+"+"+nox.record_id,source_components:[tkn.record_id,nox.record_id],method:"same-activity TKN + nitrate/nitrite"}}
    const flow=byDate.get(a.date);assert(flow,"No original same-date flow");
    return {activity,station:a.station,date:a.date,time:a.time,timezone:a.timezone,project:a.project,
      activity_depth:a.activity_depth,activity_depth_unit:a.activity_depth_unit,measurements,flow,
      season:({12:"DJF",1:"DJF",2:"DJF",3:"MAM",4:"MAM",5:"MAM",6:"JJA",7:"JJA",8:"JJA",9:"SON",10:"SON",11:"SON"})[Number(a.date.slice(5,7))]};
  }).sort((a,b)=>a.date.localeCompare(b.date)||a.station.localeCompare(b.station)||a.activity.localeCompare(b.activity));
  const routine=activities.filter(a=>a.project==="SWS-2023");
  assert(originals.length===832&&activities.length===51&&routine.length===49,"Unexpected complete original activity cohort");
  const medianEndpoint=(rs,valueKey,openKey,side)=>{
    const convert=r=>r[valueKey]===null?(side==="lower"?-Infinity:Infinity):r[valueKey];
    const a=[...rs].sort((x,y)=>convert(x)-convert(y)||(side==="lower"?Number(x[openKey])-Number(y[openKey]):Number(y[openKey])-Number(x[openKey])));
    const selected=[a[Math.floor((a.length-1)/2)],a[Math.ceil((a.length-1)/2)]];
    const value=avg(selected.map(convert));
    return {value:Number.isFinite(value)?round(value):null,open:selected.some(r=>r[openKey])||!Number.isFinite(value)};
  };
  const intervalStats=rs=>{
    const low=rs.map(r=>r.lower),high=rs.map(r=>r.upper);
    const ordered=[...rs].sort((a,b)=>(a.upper??Infinity)-(b.upper??Infinity)||Number(b.upper_open)-Number(a.upper_open));
    const lowerMedian=medianEndpoint(rs,"lower","lower_open","lower"),upperMedian=medianEndpoint(rs,"upper","upper_open","upper");
    return {n:rs.length,below:rs.filter(r=>r.censoring==="below").length,above:rs.filter(r=>r.censoring==="above").length,
      exact:rs.filter(r=>r.lower===r.upper&&!r.lower_open&&!r.upper_open).length,
      mean_lower:round(avg(low)),mean_upper:high.includes(null)?null:round(avg(high)),mean_lower_open:rs.some(r=>r.lower_open),mean_upper_open:rs.some(r=>r.upper_open),
      median_lower:lowerMedian.value,median_upper:upperMedian.value,
      median_lower_open:lowerMedian.open,median_upper_open:upperMedian.open,min_lower:Math.min(...low),max_upper:high.includes(null)?null:Math.max(...high)};
  };
  const summaries=[];
  for(const scope of["station","station_season"]){
    for(const [label,as]of group(routine,a=>scope==="station"?a.station:a.station+"|"+a.season)){
      for(const analyte of [...Object.values(names).map(v=>v[0]),"total_nitrogen"]){
        const rs=as.map(a=>a.measurements[analyte]).filter(Boolean);if(!rs.length)continue;
        summaries.push({scope,group:label,station:as[0].station,analyte,unit:rs[0].unit,...intervalStats(rs)});
      }
    }
  }
  const differences=[],pairs=[];
  const analytes=[...Object.values(names).map(v=>v[0]),"total_nitrogen"];
  for(const [date,as]of group(routine,a=>a.date)){
    as.sort((a,b)=>a.station.localeCompare(b.station));
    for(let i=0;i<as.length;i++)for(let j=i+1;j<as.length;j++){
      const a=as[i],b=as[j];
      const clock=t=>t.split(":").reduce((s,v,i)=>s+Number(v)*[60,1,1/60][i],0);
      const pair={date,station_a:a.station,station_b:b.station,activity_a:a.activity,activity_b:b.activity,
      time_a:a.time,time_b:b.time,timezone_a:a.timezone,timezone_b:b.timezone,
      clock_separation_minutes:a.timezone===b.timezone?Math.abs(clock(a.time)-clock(b.time)):null,
      flow_cfs:a.flow.flow_cfs,flow_percentile:a.flow.percentile,flow_qualifiers:a.flow.qualifiers};
      pairs.push(pair);
      for(const analyte of analytes){
        const x=a.measurements[analyte],y=b.measurements[analyte];if(!x||!y)continue;
        const lower=x.upper===null?null:round(y.lower-x.upper),upper=y.upper===null?null:round(y.upper-x.lower),
          lowerOpen=x.upper_open||y.lower_open,upperOpen=y.upper_open||x.lower_open;
        const higher=lower!==null&&(lower>0||lower===0&&lowerOpen),lowerThan=upper!==null&&(upper<0||upper===0&&upperOpen);
        differences.push({...pair,analyte,unit:x.unit,record_a:x.record_id,record_b:y.record_id,
          a_lower:x.lower,a_upper:x.upper,a_lower_open:x.lower_open,a_upper_open:x.upper_open,
          b_lower:y.lower,b_upper:y.upper,b_lower_open:y.lower_open,b_upper_open:y.upper_open,
          lower,upper,lower_open:lowerOpen,upper_open:upperOpen,direction:higher?"B higher":lowerThan?"B lower":lower===0&&upper===0?"equal":"unresolved"});
      }
    }
  }
  const pairSummaries=[...group(differences,p=>p.station_a+"|"+p.station_b+"|"+p.analyte)].map(([key,rs])=>({
    station_a:rs[0].station_a,station_b:rs[0].station_b,analyte:rs[0].analyte,unit:rs[0].unit,n:rs.length,
    b_higher:rs.filter(r=>r.direction==="B higher").length,b_lower:rs.filter(r=>r.direction==="B lower").length,
    equal:rs.filter(r=>r.direction==="equal").length,unresolved:rs.filter(r=>r.direction==="unresolved").length,
    mean_lower:rs.some(r=>r.lower===null)?null:round(avg(rs.map(r=>r.lower))),
    mean_upper:rs.some(r=>r.upper===null)?null:round(avg(rs.map(r=>r.upper))),
    mean_lower_open:rs.some(r=>r.lower_open),mean_upper_open:rs.some(r=>r.upper_open),
    median_lower:medianEndpoint(rs,"lower","lower_open","lower").value,
    median_upper:medianEndpoint(rs,"upper","upper_open","upper").value,
    median_lower_open:medianEndpoint(rs,"lower","lower_open","lower").open,
    median_upper_open:medianEndpoint(rs,"upper","upper_open","upper").open,
    clock_min:Math.min(...rs.map(r=>r.clock_separation_minutes)),clock_max:Math.max(...rs.map(r=>r.clock_separation_minutes))}));
  const rank=values=>values.map(v=>(values.filter(w=>w<v).length+1+(values.filter(w=>w<v).length+values.filter(w=>w===v).length))/2);
  function spearman(values){const a=rank(values.map(v=>v[0])),b=rank(values.map(v=>v[1])),am=avg(a),bm=avg(b);
    const num=a.reduce((s,v,i)=>s+(v-am)*(b[i]-bm),0),den=Math.sqrt(a.reduce((s,v)=>s+(v-am)**2,0)*b.reduce((s,v)=>s+(v-bm)**2,0));
    return den?round(num/den):null;}
  const associations=[];
  const associationPairs=[["temperature","oxygen"],["turbidity","phosphorus"],["turbidity","ecoli"],["bod","oxygen"],["flow","turbidity"],["flow","phosphorus"]];
  for(const [station,as]of group(routine,a=>a.station)){
    for(const[x,y]of associationPairs){
      const all=as.map(a=>({activity:a.activity,x:x==="flow"?{lower:a.flow.flow_cfs,upper:a.flow.flow_cfs,lower_open:false,upper_open:false}:a.measurements[x],y:a.measurements[y]})).filter(a=>a.x&&a.y);
      const selected=all.filter(a=>a.x.lower===a.x.upper&&a.y.lower===a.y.upper&&!a.x.lower_open&&!a.x.upper_open&&!a.y.lower_open&&!a.y.upper_open);
      associations.push({station,x,y,available_pairs:all.length,exact_pairs:selected.length,censored_pairs_excluded:all.length-selected.length,
        spearman_rho:selected.length>=3?spearman(selected.map(a=>[a.x.lower,a.y.lower])):null,
        selected_activity_ids:selected.map(a=>a.activity).join(";")});
    }
  }
  const influences=pairSummaries.filter(s=>s.n>=10).flatMap(s=>{
    const rs=differences.filter(p=>p.station_a===s.station_a&&p.station_b===s.station_b&&p.analyte===s.analyte);
    if(rs.some(r=>r.lower===null||r.upper===null))return [];
    const largest=[...rs].sort((a,b)=>Math.max(Math.abs(b.lower),Math.abs(b.upper))-Math.max(Math.abs(a.lower),Math.abs(a.upper))||a.date.localeCompare(b.date))[0];
    const rest=rs.filter(r=>r!==largest);
    return [{station_a:s.station_a,station_b:s.station_b,analyte:s.analyte,unit:s.unit,n:s.n,
      full_mean_lower:s.mean_lower,full_mean_upper:s.mean_upper,full_mean_lower_open:s.mean_lower_open,full_mean_upper_open:s.mean_upper_open,median_lower:s.median_lower,median_upper:s.median_upper,median_lower_open:s.median_lower_open,median_upper_open:s.median_upper_open,
      largest_difference_lower:largest.lower,largest_difference_upper:largest.upper,largest_difference_lower_open:largest.lower_open,largest_difference_upper_open:largest.upper_open,
      largest_date:largest.date,largest_activity_a:largest.activity_a,largest_activity_b:largest.activity_b,
      mean_without_largest_lower:round(avg(rest.map(r=>r.lower))),mean_without_largest_upper:round(avg(rest.map(r=>r.upper))),mean_without_largest_lower_open:rest.some(r=>r.lower_open),mean_without_largest_upper_open:rest.some(r=>r.upper_open),
      remaining_n:rest.length,selection:"largest absolute finite interval endpoint; full results remain primary"}];
  });
  const activityTable=activities.map(a=>{
    const row={activity:a.activity,station:a.station,date:a.date,time:a.time,timezone:a.timezone,project:a.project,
      original_activity_depth:a.activity_depth,original_activity_depth_unit:a.activity_depth_unit,
      flow_cfs:a.flow.flow_cfs,flow_percentile:a.flow.percentile,flow_qualifiers:a.flow.qualifiers,flow_source_path:a.flow.source_path,
      flow_source_sha256:a.flow.source_sha256,flow_source_record_index:a.flow.record_index};
    for(const analyte of analytes){const m=a.measurements[analyte];for(const field of["lower","upper","lower_open","upper_open","unit","censoring","record_id"])row[analyte+"_"+field]=m?m[field]??null:null}
    return row;
  });
  return {schema:"eighteenmile.physical-activity-context/v1",counts:{original_records:originals.length,selected_original_records:records.length,
      original_physical_records:records.filter(r=>physical.has(r.analyte)).length,activities:activities.length,routine_activities:routine.length,
      separate_pfas_activities:activities.length-routine.length,distinct_physical_dates:new Set(activities.map(a=>a.date)).size,
      paired_activity_dates:pairs.length,paired_characteristic_contrasts:differences.length,
      physical_contrasts:differences.filter(r=>physical.has(r.analyte)).length,daily_flow:daily.length},
    records,activities,activity_table:activityTable,summaries,pairs,differences,pair_summaries:pairSummaries,associations,influences,
    event_2023_06_12:activityTable.filter(a=>a.date==="2023-06-12"),daily};
}
export { analyzePhysicalContext };
