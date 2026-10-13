export function calculateFlowCoverage(originalFlow, selectedChlorophyllCSV, routineSources) {
  function parseCsv(text){const rows=[];let row=[],value="",quoted=false;for(let i=0;i<text.length;i++){const c=text[i];if(quoted){if(c==='"'&&text[i+1]==='"'){value+='"';i++}else if(c==='"')quoted=false;else value+=c}else if(c==='"')quoted=true;else if(c===","){row.push(value);value=""}else if(c==="\n"||c==="\r"){if(c==="\r"&&text[i+1]==="\n")i++;row.push(value);if(row.some(x=>x!==""))rows.push(row);row=[];value=""}else value+=c}if(quoted)throw Error("CSV quotation is incomplete");if(row.length||value){row.push(value);rows.push(row)}const columns=(rows.shift()||[]).map((x,i)=>i===0?x.replace(/^\uFEFF/,""):x);for(const r of rows)if(r.length!==columns.length)throw Error("CSV source row width differs: "+r.length+"/"+columns.length);return{columns,rows:rows.map(r=>Object.fromEntries(columns.map((c,i)=>[c,r[i]]))) }}
  const site = "02186702", gaugeId = "USGS-" + site, dayMS = 86400000;
  const series = originalFlow.value.timeSeries.filter(s =>
    s.sourceInfo.siteCode.some(x => x.value === site) &&
    s.variable.variableCode.some(x => x.value === "00060"));
  if (series.length !== 1 || series[0].variable.unit.unitCode !== "ft3/s")
    throw Error("Choose the original Eighteenmile daily mean discharge series");
  const sourceRows = series[0].values.flatMap((block, valuesIndex) => block.value.map((r, recordIndex) => ({
    date: r.dateTime.slice(0,10), reported_mean_cfs:r.value, mean_cfs:Number(r.value),
    qualifiers:(r.qualifiers||[]).join("|"), method_id:block.method[0].methodID,
    source_values_index:valuesIndex, source_record_index:recordIndex })));
  const rows=sourceRows.filter(r=>r.date.startsWith("2023-")).sort((a,b)=>a.date.localeCompare(b.date));
  if (rows.length!==365 || new Set(rows.map(r=>r.date)).size!==365) throw Error("Expected all 365 calendar dates");
  rows.forEach((r,i)=>{if(r.date!==new Date(Date.UTC(2023,0,1)+i*dayMS).toISOString().slice(0,10) ||
    !Number.isFinite(r.mean_cfs)||r.mean_cfs<0||r.qualifiers!=="A")throw Error("Incomplete or changed original approved flow");});
  const decimals=Math.max(...rows.map(r=>(r.reported_mean_cfs.split(".")[1]||"").length)), scale=10**decimals;
  rows.forEach(r=>{r.flow_scaled=Number(r.reported_mean_cfs.replace(".",""))*10**(decimals-(r.reported_mean_cfs.split(".")[1]||"").length);
    if(!Number.isSafeInteger(r.flow_scaled))throw Error("Original decimal discharge exceeds exact integer sum");});
  const sum=a=>a.reduce((n,r)=>n+r.flow_scaled,0)/scale;
  const volume=a=>sum(a)* 86400* 0.028316846592;
  const byDate=new Map(rows.map(r=>[r.date,r]));
  const quantile=(a,p)=>{const k=(a.length-1)*p,i=Math.floor(k);return a[i]+(a[Math.min(i+1,a.length-1)]-a[i])*(k-i);};
  const sorted=rows.map(r=>r.mean_cfs).sort((a,b)=>a-b);
  const cuts=[0,quantile(sorted,.25),quantile(sorted,.5),quantile(sorted,.75),quantile(sorted,.9),quantile(sorted,.95),Infinity];
  const names=["below_p25","p25_to_p50","p50_to_p75","p75_to_p90","p90_to_p95","at_or_above_p95"];
  const rawChla=parseCsv(selectedChlorophyllCSV).rows;
  if(rawChla.length!==75||new Set(rawChla.map(r=>r.sample_date)).size!==15)throw Error("Expected the original 75 selected CHLA records");
  const activities=[];
  for(const r of rawChla)activities.push({cohort:r.project_id,station_id:r.station_id,activity_id:r.activity_id,
    sample_date:r.sample_date,sample_time:r.sample_time,sample_timezone:r.sample_timezone,record_ids:[r.record_id],
    source_records:[{source_path:r.source_path,source_sha256:r.source_sha256,source_record_index:Number(r.source_record_index),source_record_index_base:1}]});
  const routineActivities=new Map();
  for(const source of routineSources)for(const [sourceIndex,r]of parseCsv(source.content).rows.entries()){
    const key=r.ActivityIdentifier;
    if(!key||r.ProjectIdentifier!=="SWS-2023"||!byDate.has(r.ActivityStartDate))throw Error("Choose the original 2023 SWS nutrient responses");
    const meta={cohort:r.ProjectIdentifier,station_id:r.MonitoringLocationIdentifier,activity_id:key,
      sample_date:r.ActivityStartDate,sample_time:r["ActivityStartTime/Time"],sample_timezone:r["ActivityStartTime/TimeZoneCode"]};
    if(!routineActivities.has(key))routineActivities.set(key,{...meta,record_ids:[],source_records:[]});
    const a=routineActivities.get(key);
    for(const [k,v]of Object.entries(meta))if(a[k]!==v)throw Error("Conflicting original routine activity metadata");
    a.source_records.push({source_path:source.path,source_sha256:source.sha256,source_record_index:sourceIndex,source_record_index_base:0});
    a.record_ids.push(source.sha256+":"+sourceIndex);
  }
  if(routineActivities.size!==24)throw Error("Expected the original 24 routine nutrient activities");
  activities.push(...routineActivities.values());
  const cohortDates={};
  for(const a of activities){
    const flow=byDate.get(a.sample_date);if(!flow)throw Error("Missing original sampling-date discharge");
    const band=names.find((n,i)=>flow.mean_cfs>=cuts[i]&&flow.mean_cfs<cuts[i+1]);
    Object.assign(a,{gauge_id:gaugeId,same_date_mean_cfs:flow.mean_cfs,flow_band:band,
      annual_flow_midrank_pct:100*(rows.filter(r=>r.mean_cfs<flow.mean_cfs).length+
        .5*rows.filter(r=>r.mean_cfs===flow.mean_cfs).length)/365,
      flow_qualifiers:flow.qualifiers,flow_method_id:flow.method_id,
      flow_source_values_index:flow.source_values_index,flow_source_record_index:flow.source_record_index,
      calendar_join:"Original sampling calendar date and upstream gauge reporting date"});
    (cohortDates[a.cohort]??=new Set()).add(a.sample_date);
  }
  const datesFor=cohort=>new Set(activities.filter(a=>a.cohort===cohort).map(a=>a.sample_date));
  const scopes=[{id:"calendar_2023",start:"2023-01-01",end:"2023-12-31"},
    {id:"lake_study_2023",start:"2023-04-05",end:"2023-10-17"}];
  const duration=[],sampling=[],ranked=[];
  for(const scope of scopes){
    const within=r=>r.date>=scope.start&&r.date<=scope.end, daily=rows.filter(within),total=volume(daily);
    for(let i=0;i<names.length;i++){
      const b=daily.filter(r=>r.mean_cfs>=cuts[i]&&r.mean_cfs<cuts[i+1]);
      const dated=new Set(b.map(r=>r.date));
      duration.push({scope:scope.id,period_start:scope.start,period_end:scope.end,gauge_id:gaugeId,
        annual_flow_band:names[i],lower_cfs_inclusive:cuts[i],upper_cfs_exclusive:Number.isFinite(cuts[i+1])?cuts[i+1]:null,
        days:b.length,period_days:daily.length,day_pct:100*b.length/daily.length,
        observed_volume_m3:volume(b),period_volume_m3:total,volume_pct:100*volume(b)/total,
        chla_visit_dates:[...datesFor("CHLA")].filter(d=>dated.has(d)),
        routine_visit_dates:[...datesFor("SWS-2023")].filter(d=>dated.has(d))});
    }
    const cohorts=[{id:"CHLA",items:activities.filter(a=>a.cohort==="CHLA")},
      {id:"SWS-2023",items:activities.filter(a=>a.cohort==="SWS-2023")},
      ...[...new Set(activities.filter(a=>a.cohort==="SWS-2023").map(a=>a.station_id))]
       .map(id=>({id:"SWS-2023:"+id,items:activities.filter(a=>a.cohort==="SWS-2023"&&a.station_id===id)}))];
    for(const cohort of cohorts){
      const a=cohort.items.filter(a=>a.sample_date>=scope.start&&a.sample_date<=scope.end),
        dates=[...new Set(a.map(a=>a.sample_date))].sort(),onDates=dates.map(d=>byDate.get(d)),
        q=onDates.map(r=>r.mean_cfs).sort((a,b)=>a-b);
      sampling.push({scope:scope.id,cohort:cohort.id,period_start:scope.start,period_end:scope.end,
        gauge_id:gaugeId,station_count:new Set(a.map(x=>x.station_id)).size,activity_count:a.length,
        distinct_dates:dates.length,reference_days:daily.length,
        visit_date_mean_cfs:q.length?sum(onDates)/q.length:null,visit_date_median_cfs:q.length?quantile(q,.5):null,
        minimum_visit_date_cfs:q.length?q[0]:null,maximum_visit_date_cfs:q.length?q.at(-1):null,
        period_mean_cfs:sum(daily)/daily.length,
        visit_date_mean_to_period_mean_ratio:q.length?(sum(onDates)/q.length)/(sum(daily)/daily.length):null,
        at_or_above_annual_p95_dates:dates.filter(d=>byDate.get(d).mean_cfs>=cuts[5]),
        gauge_volume_on_visit_dates_m3:volume(onDates),
        gauge_volume_on_visit_dates_pct:100*volume(onDates)/total,period_volume_m3:total,
        dates});
    }
    const descending=[...daily].sort((a,b)=>b.mean_cfs-a.mean_cfs||a.date.localeCompare(b.date));
    for(const count of [1,5,10,Math.ceil(daily.length*.05),Math.ceil(daily.length*.1)]){
      const chosen=descending.slice(0,count);
      if(ranked.some(x=>x.scope===scope.id&&x.days===count))continue;
      ranked.push({scope:scope.id,gauge_id:gaugeId,days:count,day_pct:100*count/daily.length,
        minimum_selected_cfs:chosen.at(-1).mean_cfs,observed_volume_m3:volume(chosen),
        period_volume_m3:total,volume_pct:100*volume(chosen)/total,dates:chosen.map(r=>r.date)});
    }
  }
  const high=rows.filter(r=>r.mean_cfs>=cuts[5]),spells=[];
  for(const row of high){let spell=spells.at(-1);if(!spell||Date.parse(row.date)-Date.parse(spell.at(-1).date)!==dayMS)spells.push(spell=[]);spell.push(row);}
  const spellRows=spells.map((spell,i)=>{
    const start=spell[0].date,end=spell.at(-1).date,peak=Math.max(...spell.map(r=>r.mean_cfs));
    const close=cohort=>{
      const dates=[...datesFor(cohort)].sort(),before=dates.filter(d=>d<start).at(-1)??null,
        after=dates.find(d=>d>end)??null,same=dates.filter(d=>d>=start&&d<=end);
      return {same_day_dates:same,preceding_date:before,days_since_preceding:before?(Date.parse(start)-Date.parse(before))/dayMS:null,
        following_date:after,days_to_following:after?(Date.parse(after)-Date.parse(end))/dayMS:null};
    };
    return {spell_id:"eighteenmile-2023-high-flow-"+String(i+1).padStart(2,"0"),gauge_id:gaugeId,
      start_date:start,end_date:end,days:spell.length,annual_p95_threshold_cfs:cuts[5],
      peak_daily_mean_cfs:peak,peak_dates:spell.filter(r=>r.mean_cfs===peak).map(r=>r.date),
      observed_volume_m3:volume(spell),annual_observed_volume_pct:100*volume(spell)/volume(rows),
      within_lake_study:spell.every(r=>r.date>="2023-04-05"&&r.date<="2023-10-17"),
      chla:close("CHLA"),routine:close("SWS-2023"),
      original_records:spell.map(r=>({date:r.date,value:r.reported_mean_cfs,qualifiers:r.qualifiers,
        method_id:r.method_id,source_values_index:r.source_values_index,source_record_index:r.source_record_index}))};
  });
  const dailyContext=rows.map(r=>({...r,gauge_id:gaugeId,
    flow_band:names.find((n,i)=>r.mean_cfs>=cuts[i]&&r.mean_cfs<cuts[i+1]),
    observed_volume_m3:r.mean_cfs* 86400* 0.028316846592,
    chla_activities:activities.filter(a=>a.cohort==="CHLA"&&a.sample_date===r.date).map(a=>a.activity_id),
    routine_activities:activities.filter(a=>a.cohort==="SWS-2023"&&a.sample_date===r.date).map(a=>a.activity_id)}));
  return {schema:"upstate.eighteenmile-sampling-flow-coverage/v1",gauge_id:gaugeId,
    method:{flow:"Original USGS 00060 daily mean, statistic 00003; all 365 original 2023 records approved",
      decimal_sum:"Exact original decimal discharge summed as safe integers before conversion",
      volume:"Original daily mean * 86400 nominal reporting seconds * 0.028316846592 cubic metres per cubic foot",
      quantiles:"Linear interpolation at(n-1)*p; annual thresholds reused in both reporting scopes",
      high_flow_spell:"Consecutive calendar days at or above the annual 95th percentile; no event separation inference",
      sampling:"Exact original calendar dates; each cohort visit date counted once across stations",
      volume_coverage:"Gauge volume occurring on sampled calendar days; distinct from the fraction of water or constituent mass sampled"},
    annual:{days:365,approved_days:365,mean_cfs:sum(rows)/365,volume_m3:volume(rows),
      p25_cfs:cuts[1],p50_cfs:cuts[2],p75_cfs:cuts[3],p90_cfs:cuts[4],p95_cfs:cuts[5],
      high_flow_days:high.length,high_flow_spells:spells.length,high_flow_volume_m3:volume(high),
      high_flow_volume_pct:100*volume(high)/volume(rows)},
    duration,sampling,ranked,spells:spellRows,activities,daily:dailyContext};
}
