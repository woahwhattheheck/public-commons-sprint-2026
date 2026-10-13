// Source-bound same-day observations in original directed NLDI river order.
export function analyzeObservationNetwork(input, parseCSV, sha256, byteLength) {
  const assert=(ok,m)=>{if(!ok)throw Error("observation_network: "+m)};
  const own=(o,k)=>Object.prototype.hasOwnProperty.call(o,k);
  const stable=o=>JSON.stringify(o);
  const sources=new Map();
  for(const f of input.files){
    assert(typeof f.content==="string"&&Number.isSafeInteger(f.bytes),"source body "+f.path);
    assert(byteLength(f.content)===f.bytes&&sha256(f.content)===f.sha256,"source identity "+f.path);
    if(sources.has(f.path))assert(sources.get(f.path).sha256===f.sha256,"conflicting source "+f.path);
    else sources.set(f.path,f);
  }
  const ref=f=>({path:f.path,sha256:f.sha256,bytes:f.bytes,...(f.uri?{uri:f.uri}:{})});
  const file=d=>{const f=sources.get(d.path);assert(f&&f.sha256===d.sha256&&f.bytes===d.bytes,"binding "+d.path);return f};
  const json=d=>JSON.parse(file(d).content);
  const historical=json(input.historical),current=json(input.current),network=json(input.network);
  const currentRows=parseCSV(file(input.current_measurements).content);
  assert(historical.schema==="upstate.three-twenty-historical-study/v1","historical schema");
  assert(current.schema==="three-twenty.original-multistation-study/v1", "current schema "+current.schema);
  const originalDescriptors=new Map();
  for(const d of [...historical.source_files,...current.input_files,...network.sources]){
    file(d);
    const old=originalDescriptors.get(d.path);assert(!old||old.sha256===d.sha256,"original source conflict");
    originalDescriptors.set(d.path,d);
  }
  const parsed=new Map();
  const csv=p=>{if(!parsed.has(p))parsed.set(p,parseCSV(sources.get(p).content));return parsed.get(p)};
  const rowAt=r=>{const f=sources.get(r.source_path);assert(f&&f.sha256===r.source_sha256,"row source");
    assert(Number.isInteger(r.source_csv_row)&&r.source_csv_row>=2,"physical CSV row");
    const row=csv(f.path)[r.source_csv_row-2];assert(row,"missing original row");return row};
  const physical=(selector)=>{
    const at=selector.lastIndexOf(":"),hash=selector.slice(0,at),n=Number(selector.slice(at+1));
    const ds=[...originalDescriptors.values()].filter(d=>d.sha256===hash);
    assert(ds.length===1&&Number.isInteger(n)&&n>=1,"2026 data-row selector "+selector);
    return {source_path:ds[0].path,source_sha256:hash,source_csv_row:n+1};
  };
  const split=s=>s?String(s).split(";"):[];
  const bool=x=>x===true||x==="true";
  const bound=x=>x===""||x===null?null:Number(x);
  const interval=(a,b,ac=true,bc=true)=>({lower:a,upper:b,lower_inclusive:ac,upper_inclusive:bc});
  const checkInterval=i=>{assert(i&&[i.lower,i.upper].every(v=>v===null||Number.isFinite(v)),"interval finite endpoints");
    assert(i.lower===null||i.upper===null||i.lower<=i.upper,"interval ordering");return i};
  const minus=(b,a)=>interval(b.lower===null||a.upper===null?null:b.lower-a.upper,b.upper===null||a.lower===null?null:b.upper-a.lower,b.lower_inclusive&&a.upper_inclusive,b.upper_inclusive&&a.lower_inclusive);
  const negate=i=>interval(i.upper===null?null:-i.upper,i.lower===null?null:-i.lower,i.upper_inclusive,i.lower_inclusive);
  const near=(a,b)=>a===b||(a!==null&&b!==null&&Math.abs(a-b)<=1e-10*Math.max(1,Math.abs(a),Math.abs(b)));
  const sameInterval=(a,b)=>near(a.lower,b.lower)&&near(a.upper,b.upper)&&a.lower_inclusive===b.lower_inclusive&&a.upper_inclusive===b.upper_inclusive;
  const direction=i=>i.lower!==null&&(i.lower>0||(i.lower===0&&!i.lower_inclusive))?"higher":i.upper!==null&&(i.upper<0||(i.upper===0&&!i.upper_inclusive))?"lower":i.lower===0&&i.upper===0&&i.lower_inclusive&&i.upper_inclusive?"equal":"unresolved";
  const fields=historical.method.compatibility_fields;
  const support=m=>Object.fromEntries(fields.map(k=>[k,m[k]??""]));
  const hMeasurements=[...historical.measurements,...historical.reconstructed_nitrogen];
  const rawResultMap=new Map();
  for(const d of originalDescriptors.values())if(d.role==="results")for(const [i,row]of csv(d.path).entries()){
    const id=row.ResultIdentifier,old=rawResultMap.get(id);
    if(old)assert(stable(old.raw)===stable(row),"different raw row for "+id);
    else rawResultMap.set(id,{raw:row,source:{source_path:d.path,source_sha256:d.sha256,source_csv_row:i+2}});
  }
  const metadata=(r,a,unit)=>({
    characteristic:r.CharacteristicName,unit,fraction:r.ResultSampleFractionText,speciation:r.MethodSpecificationName,
    method_id:r["ResultAnalyticalMethod/MethodIdentifier"],method_context:r["ResultAnalyticalMethod/MethodIdentifierContext"],method_name:r["ResultAnalyticalMethod/MethodName"],
    result_status:r.ResultStatusIdentifier,value_type:r.ResultValueTypeName,activity_type:a.ActivityTypeCode,media:a.ActivityMediaName,
    collection_method:a["SampleCollectionMethod/MethodIdentifier"],collection_context:a["SampleCollectionMethod/MethodIdentifierContext"],
    qualifier:r.MeasureQualifierCode,activity_depth:a["ActivityDepthHeightMeasure/MeasureValue"],activity_depth_unit:a["ActivityDepthHeightMeasure/MeasureUnitCode"],
    result_depth:r["ResultDepthHeightMeasure/MeasureValue"],result_depth_unit:r["ResultDepthHeightMeasure/MeasureUnitCode"],weight_basis:r.ResultWeightBasisText,time_basis:r.ResultTimeBasisText,
    temperature_basis:r.ResultTemperatureBasisText,particle_size_basis:r.ResultParticleSizeBasisText,statistical_base:r.StatisticalBaseCode
  });
  function validateMeasurement(m){
    assert(m.result_ids.length===new Set(m.result_ids).size,"duplicate result ID within measurement");
    const rr=m.result_sources.map(rowAt);
    assert(stable(rr.map(r=>r.ResultIdentifier).sort())===stable([...m.result_ids].sort()),"result/source identity set");
    for(const r of rr){
      assert(r.ActivityIdentifier===m.activity_id&&r.MonitoringLocationIdentifier==="21SC60WQ_WQX-"+m.station,"measurement activity/site");
      assert(r.ActivityStartDate===m.date&&r["ActivityStartTime/Time"]===m.time&&r["ActivityStartTime/TimeZoneCode"]===m.timezone,"measurement clock");
    }
    const a=rowAt(m.activity_source);
    assert(a.ActivityIdentifier===m.activity_id&&a.ProjectIdentifier===m.project,"activity metadata");
    for(const r of m.limit_sources??[]){const l=rowAt(r);assert(m.result_ids.includes(l.ResultIdentifier)&&l.ActivityIdentifier===m.activity_id,"limit identity");}
    checkInterval(m.interval);
    return m;
  }
  for(const m of hMeasurements)validateMeasurement(m);
  const cMeasurements=currentRows.map(r=>{
    const refs=split(r.original_selectors).map(physical),ids=split(r.result_ids);
    const raw=refs.map(rowAt),aRef={source_path:r.activity_source_path,source_sha256:r.activity_source_sha256,source_csv_row:Number(r.activity_source_row)+1},a=rowAt(aRef);
    assert(raw.length===Number(r.result_count),"current repeated-result count");
    const ignore=new Set(["ResultIdentifier","ResultDetectionQuantitationLimitUrl"]);
    for(const other of raw)for(const key of Object.keys(raw[0]))if(!ignore.has(key))assert(raw[0][key]===other[key],"nonagreeing current original "+key);
    return validateMeasurement({...metadata(raw[0],a,r.unit),station:r.station,activity_id:r.activity,date:r.date,time:r.time,timezone:r.timezone,project:r.project,
      raw_value:r.reported_value,raw_unit:r.reported_unit,condition:r.condition,status:r.censoring==="none"?"quantified":r.censoring,
      interval:interval(bound(r.lower),bound(r.upper),!bool(r.lower_open),!bool(r.upper_open)),result_ids:ids,result_sources:refs,
      activity_source:aRef,limit_sources:split(r.limit_selectors).map(physical),quality_flag:r.quality,analysis_eligible:bool(r.analysis_eligible)});
  });
  assert(cMeasurements.length===current.counts.measurements,"current measurement census");
  const findMeasurement=(arr,activity,characteristic,ids)=>{
    const wanted=[...ids].sort().join("|"),ms=arr.filter(m=>m.activity_id===activity&&m.characteristic===characteristic&&[...m.result_ids].sort().join("|")===wanted);
    assert(ms.length===1,"measurement join "+activity+" "+characteristic);return ms[0];
  };
  const nav=network.navigation;
  assert(nav.mode==="DM"&&network.topology.complete_order===true&&network.topology.component_count===1&&!network.topology.branch_nodes.length,"directed network topology");
  const originalDM=JSON.parse(file(nav.source).content),byCOMID=new Map(originalDM.features.map(f=>[String(f.properties.nhdplus_comid),f]));
  assert(byCOMID.size===network.reaches.length,"original reach census");
  const ordered=[...network.reaches].sort((a,b)=>a.order-b.order);
  for(const [i,r]of ordered.entries()){
    const f=byCOMID.get(String(r.comid));assert(f&&stable(f.geometry)===stable(r.geometry)&&r.order===i,"original reach geometry/order");
    assert(!r.source_coordinate_order_reversed,"unexpected reversed original reach");
    if(i)assert(stable(ordered[i-1].geometry.coordinates.at(-1))===stable(r.geometry.coordinates[0]),"disconnected directed original endpoints");
  }
  const stations=[...network.stations].sort((a,b)=>ordered.findIndex(r=>r.comid===a.indexed_comid)-ordered.findIndex(r=>r.comid===b.indexed_comid));
  const position=new Map(stations.map((s,i)=>[s.station_id,i]));
  for(const s of stations){const f=JSON.parse(file(s.indexed_source).content);
    assert(String(f.features[0].properties.comid)===String(s.indexed_comid),"original station COMID");
    assert(ordered.some(r=>r.comid===s.indexed_comid),"station outside directed chain");
  }
  assert(stations.map(s=>s.station_id).join("|")==="SV-833|RS-26250|SV-735|SV-111","four-station order");
  const networkBinding={source:ref(file(nav.source)),station_order:stations.map(s=>s.station_id),ordered_station_comids:stations.map(s=>String(s.indexed_comid)),
    station_sources:stations.map(s=>({station_id:s.station_id,...ref(file(s.indexed_source))})),ordered_reach_comids:ordered.map(r=>r.comid),endpoint_matching:network.topology.endpoint_matching};
  const excluded=historical.measurements.filter(m=>m.quality_flag);
  assert(excluded.length===1&&excluded[0].result_ids.join("|")==="STORET-1104042240"&&excluded[0].raw_value==="724","source-owned explicit pH flag");
  const flaggedIDs=new Set(excluded.flatMap(m=>m.result_ids));
  const rows=[];
  function add(a,b,sourceDelta,sourceRow,period,basis){
    assert(a.date===b.date,"not same original date");
    assert(!a.result_ids.some(id=>flaggedIDs.has(id))&&!b.result_ids.some(id=>flaggedIDs.has(id)),"flagged result in contrast");
    assert(stable(support(a))===stable(support(b)),"different comparison support "+a.characteristic);
    const computed=minus(b.interval,a.interval);
    assert(sameInterval(computed,checkInterval(sourceDelta)),"retained difference mismatch");
    const aFirst=position.get(a.station)<position.get(b.station),u=aFirst?a:b,d=aFirst?b:a;
    assert(position.has(a.station)&&position.has(b.station)&&a.station!==b.station,"unbound station pair");
    const delta=aFirst?sourceDelta:negate(sourceDelta);
    const season=["DJF","DJF","MAM","MAM","MAM","JJA","JJA","JJA","SON","SON","SON","DJF"][Number(a.date.slice(5,7))-1];
    const clock=t=>{assert(/^\d\d:\d\d:\d\d$/.test(t),"original clock");return t.split(":").reduce((v,x)=>60*v+Number(x),0)/60};
    const minuteGap=u.timezone===d.timezone?clock(d.time)-clock(u.time):null;
    const pair=network.pairs.find(p=>new Set([p.station_a,p.station_b]).size===2&&[p.station_a,p.station_b].includes(u.station)&&[p.station_a,p.station_b].includes(d.station));
    assert(pair&&pair.relation!=="unresolved","missing network relationship");
    const comparableSupport=support(u);
    const cohort={upstream_station_id:u.station,downstream_station_id:d.station,project_upstream:u.project,project_downstream:d.project,support:comparableSupport};
    rows.push({id:"comparison-"+String(rows.length+1).padStart(4,"0"),period,date:a.date,year:Number(a.date.slice(0,4)),season,season_year:Number(a.date.slice(0,4))+(a.date.slice(5,7)==="12"?1:0),
      upstream_station_id:u.station,downstream_station_id:d.station,upstream_comid:stations.find(s=>s.station_id===u.station).indexed_comid,downstream_comid:stations.find(s=>s.station_id===d.station).indexed_comid,
      approximate_network_distance_m:pair.approximate_network_distance_m,characteristic:a.characteristic,unit:a.unit,support:comparableSupport,cohort_key:sha256(stable(cohort)),cohort,
      upstream:u,downstream:d,delta,direction:direction(delta),signed_literal_clock_minutes_downstream_minus_upstream:minuteGap,
      time_basis:u.timezone===d.timezone?"original matching timezone labels; literal local-clock difference":"original timezone labels differ; elapsed interval not calculated",
      same_project:u.project===d.project,statistic_basis:basis,
      original_comparison:{station_a:a.station,station_b:b.station,delta_b_minus_a:sourceDelta,geographic_sign:aFirst?1:-1,source:sourceRow}});
  }
  for(const [i,r]of historical.contrasts.entries()){
    const a=findMeasurement(hMeasurements,r.activity_a,r.characteristic,r.result_ids_a),b=findMeasurement(hMeasurements,r.activity_b,r.characteristic,r.result_ids_b);
    assert(sameInterval(a.interval,r.interval_a)&&sameInterval(b.interval,r.interval_b),"historical retained interval");
    add(a,b,r.delta,{...input.historical,json_pointer:"/contrasts/"+i},"2021–2025","one original activity measurement; source-derived TN separate");
  }
  for(const [i,r]of current.contrasts.entries()){
    assert(r.compatible===true,"current incompatible source row requires separate review");
    const a=findMeasurement(cMeasurements,r.activity_a,r.characteristic,split(r.result_ids_a)),b=findMeasurement(cMeasurements,r.activity_b,r.characteristic,split(r.result_ids_b));
    add(a,b,interval(r.b_minus_a_lower,r.b_minus_a_upper,!r.difference_lower_open,!r.difference_upper_open),
      {...input.current,json_pointer:"/contrasts/"+i},"2026","one agreeing activity/characteristic measurement; all original IDs retained");
  }
  // Add the already retained same-activity TN sums at the single shared 2026 sampling day.
  const derivedTN=[];
  for(const [i,n]of current.nitrogen.entries()){
    const t=findMeasurement(cMeasurements,n.activity,"Kjeldahl nitrogen",split(n.tkn_result_ids)),o=findMeasurement(cMeasurements,n.activity,"Nitrate + Nitrite",split(n.nox_result_ids));
    assert(t.unit==="mg/L"&&o.unit==="mg/L"&&t.speciation==="as N"&&o.speciation==="as N"&&t.fraction===o.fraction,"TN component support");
    const sum=interval(t.interval.lower+o.interval.lower,t.interval.upper===null||o.interval.upper===null?null:t.interval.upper+o.interval.upper,t.interval.lower_inclusive&&o.interval.lower_inclusive,t.interval.upper_inclusive&&o.interval.upper_inclusive);
    const retained=interval(n.lower,n.upper,!n.lower_open,!n.upper_open);assert(sameInterval(sum,retained),"retained TN sum");
    derivedTN.push({...t,characteristic:"Reconstructed total nitrogen",method_id:stable([t.method_id,o.method_id]),method_context:stable([t.method_context,o.method_context]),
      method_name:"Original same-activity Kjeldahl nitrogen + nitrate and nitrite, each as N",value_type:"Derived from original Actual components",raw_value:"",raw_unit:"",condition:"",
      status:t.status==="quantified"&&o.status==="quantified"?"quantified":"censored_components",interval:retained,result_ids:[...t.result_ids,...o.result_ids],result_sources:[...t.result_sources,...o.result_sources],
      limit_sources:[...t.limit_sources,...o.limit_sources],component_intervals:[{characteristic:t.characteristic,interval:t.interval},{characteristic:o.characteristic,interval:o.interval}],retained_tn_pointer:"/nitrogen/"+i});
  }
  let added=0;
  for(const p of current.date_pairs){
    const a=derivedTN.find(x=>x.activity_id===p.activity_a),b=derivedTN.find(x=>x.activity_id===p.activity_b);
    if(a&&b){add(a,b,minus(b.interval,a.interval),{...input.current,json_pointers:[a.retained_tn_pointer,b.retained_tn_pointer],operation:"difference of retained same-activity TKN+NOx sums"},"2026","derived TKN+NOx from two agreeing activity measurements");added++;}
  }
  const groups=(values,key)=>{const m=new Map();for(const r of values){const k=key(r);if(!m.has(k))m.set(k,[]);m.get(k).push(r)}return [...m.values()]};
  const summarize=rs=>{
    const values=rs.map(r=>r.delta),n=rs.length;
    const mean=interval(values.some(v=>v.lower===null)?null:values.reduce((s,v)=>s+v.lower,0)/n,values.some(v=>v.upper===null)?null:values.reduce((s,v)=>s+v.upper,0)/n,
      values.every(v=>v.lower_inclusive),values.every(v=>v.upper_inclusive));
    const counts=Object.fromEntries(["higher","lower","equal","unresolved"].map(k=>[k,rs.filter(r=>r.direction===k).length]));
    const dates=[...new Set(rs.map(r=>r.date))].sort();
    return {cohort_key:rs[0].cohort_key,...rs[0].cohort,n,dates,date_count:dates.length,years:[...new Set(rs.map(r=>r.year))].sort(),first_date:dates[0],last_date:dates.at(-1),...counts,
      mean_downstream_minus_upstream_interval:mean,comparison_ids:rs.map(r=>r.id),interpretation:"Descriptive observed sample differences within exact support and project strata; no time weighting, load or causal attribution."};
  };
  const cohortSummaries=groups(rows,r=>r.cohort_key).map(summarize);
  const seasonal=groups(rows,r=>r.cohort_key+"|"+r.season).map(rs=>({...summarize(rs),season:rs[0].season,season_years:[...new Set(rs.map(r=>r.season_year))].sort()}));
  const periodSummaries=groups(rows,r=>r.cohort_key+"|"+r.period).map(rs=>({...summarize(rs),period:rs[0].period}));
  const crossPeriod=cohortSummaries.filter(s=>new Set(rows.filter(r=>r.cohort_key===s.cohort_key).map(r=>r.period)).size>1).map(s=>({
    cohort_key:s.cohort_key,...s.cohort,periods:periodSummaries.filter(x=>x.cohort_key===s.cohort_key),
    interpretation:"Historical repeated pairs versus one 2026 sampling day; this is a sampled comparison, not an interannual trend estimate."
  }));
  const coverage=[];
  const activities=[...historical.activities.map(a=>({...a,period:"2021–2025"})),...current.activities.map(a=>({...a,activity_id:a.activity,period:"2026"}))];
  for(let i=0;i<stations.length;i++)for(let j=i+1;j<stations.length;j++){
    const u=stations[i].station_id,d=stations[j].station_id;
    for(const period of ["2021–2025","2026"]){
      const aa=activities.filter(a=>a.period===period&&a.station===u),bb=activities.filter(a=>a.period===period&&a.station===d),paired=rows.filter(r=>r.period===period&&r.upstream_station_id===u&&r.downstream_station_id===d);
      coverage.push({upstream_station_id:u,downstream_station_id:d,period,upstream_activities:aa.length,downstream_activities:bb.length,
        shared_dates:[...new Set(aa.filter(a=>bb.some(b=>b.date===a.date)).map(a=>a.date))].sort(),compatible_contrasts:paired.length,
        same_day_activity_pairs:new Set(paired.map(r=>r.upstream.activity_id+"|"+r.downstream.activity_id)).size,
        status:paired.length?"observed same-day comparisons":"no compatible same-day comparison in retained sampling"});
    }
  }
  return {schema:"upstate.network-observation-comparison/v1",title:"Original observations along Three and Twenty Creek",network_binding:networkBinding,
    input_sources:[input.historical,input.current,input.current_measurements,input.network],original_observation_sources:[...originalDescriptors.values()].filter(d=>["results","activities","limits","station"].includes(d.role)).map(d=>({...ref(file(d)),role:d.role,station:d.station??null})),
    counts:{retained_historical_contrasts:historical.contrasts.length,retained_current_contrasts:current.contrasts.length,added_current_TN_contrasts:added,total_contrasts:rows.length,
      historical_original_results:historical.measurements.length,historical_eligible_measurements:historical.measurements.length-excluded.length,current_original_results:current.counts.original_results,current_activity_measurements:cMeasurements.length,
      source_flagged_original_results:excluded.length,cohorts:cohortSummaries.length,same_day_activity_pairs:new Set(rows.map(r=>r.date+"|"+r.upstream.activity_id+"|"+r.downstream.activity_id)).size},
    methods:{orientation:"Downstream minus upstream; original B−A interval and geographic sign retained in each row. Negation swaps bounds and endpoint inclusivity.",
      compatibility_fields:fields,project_scope:"Exact upstream/downstream project pair retained in each statistical cohort.",time_support:"Same original calendar day; original clocks and timezone labels retained verbatim. Clock offsets are not travel times.",
      seasons:"DJF, MAM, JJA and SON by original sampling month; December belongs to following DJF season-year. Uneven observed sample coverage is retained.",
      intervals:"Nonnegative below-limit intervals and unbounded above-limit intervals come from original study kernels; no censor substitution. Null means unbounded endpoint, not zero.",
      weighting:"One compatible activity comparison per measure; agreeing repeated 2026 result rows count once per activity and characteristic, while each distinct original ResultIdentifier remains available. Reconstructed TN remains a named derived measure.",
      exclusions:"Exact source-owned flagged pH result STORET-1104042240 remains in excluded_original_records and original files; it enters no contrast or summary.",
      scope:"Observed concentration and field-measurement differences; no flux/load, compliance, transport-time or causal inference."},
    coverage,comparisons:rows,cohort_summaries:cohortSummaries,seasonal_summaries:seasonal,period_summaries:periodSummaries,cross_period:crossPeriod,excluded_original_records:excluded};
}
