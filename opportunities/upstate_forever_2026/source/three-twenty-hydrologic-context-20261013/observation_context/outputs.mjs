export function observationNetworkOutputs(body,network,renderSection,styles){
 const csv=(rows,keys)=>{keys=keys??Object.keys(rows[0]??{});const cell=v=>{const s=v===null||v===undefined?"":typeof v==="object"?JSON.stringify(v):String(v);return /[",\r\n]/.test(s)?'"'+s.replaceAll('"','""')+'"':s};
 return keys.map(cell).join(",")+"\n"+rows.map(r=>keys.map(k=>cell(r[k])).join(",")).join("\n")+(rows.length?"\n":"");};
 const comparisons=body.comparisons.map(r=>({
  comparison_id:r.id,date:r.date,period:r.period,year:r.year,season:r.season,season_year:r.season_year,
  upstream_station_id:r.upstream_station_id,downstream_station_id:r.downstream_station_id,upstream_comid:r.upstream_comid,downstream_comid:r.downstream_comid,
  characteristic:r.characteristic,unit:r.unit,upstream_interval:r.upstream.interval,downstream_interval:r.downstream.interval,downstream_minus_upstream:r.delta,direction:r.direction,
  upstream_activity_id:r.upstream.activity_id,downstream_activity_id:r.downstream.activity_id,upstream_clock:r.upstream.time,downstream_clock:r.downstream.time,
  upstream_timezone:r.upstream.timezone,downstream_timezone:r.downstream.timezone,signed_literal_clock_minutes_downstream_minus_upstream:r.signed_literal_clock_minutes_downstream_minus_upstream,
  upstream_project:r.upstream.project,downstream_project:r.downstream.project,same_project:r.same_project,approximate_network_distance_m:r.approximate_network_distance_m,
  upstream_result_ids:r.upstream.result_ids,downstream_result_ids:r.downstream.result_ids,upstream_original_result_sources:r.upstream.result_sources,downstream_original_result_sources:r.downstream.result_sources,
  upstream_activity_source:r.upstream.activity_source,downstream_activity_source:r.downstream.activity_source,upstream_original_limit_sources:r.upstream.limit_sources,downstream_original_limit_sources:r.downstream.limit_sources,
  upstream_reported_value:r.upstream.raw_value,downstream_reported_value:r.downstream.raw_value,upstream_reported_unit:r.upstream.raw_unit,downstream_reported_unit:r.downstream.raw_unit,
  upstream_detection_condition:r.upstream.condition,downstream_detection_condition:r.downstream.condition,support:r.support,cohort_key:r.cohort_key,
  original_station_a:r.original_comparison.station_a,original_station_b:r.original_comparison.station_b,original_delta_b_minus_a:r.original_comparison.delta_b_minus_a,geographic_sign:r.original_comparison.geographic_sign,
  original_comparison_source:r.original_comparison.source,statistic_basis:r.statistic_basis
 }));
 const summary=rows=>rows.map(r=>({...r,characteristic:r.support.characteristic,unit:r.support.unit,method_id:r.support.method_id,method_context:r.support.method_context,fraction:r.support.fraction,speciation:r.support.speciation}));
 const excluded=body.excluded_original_records.map(m=>({station:m.station,date:m.date,activity_id:m.activity_id,characteristic:m.characteristic,reported_value:m.raw_value,reported_unit:m.raw_unit,original_result_ids:m.result_ids,original_result_sources:m.result_sources,activity_source:m.activity_source,limit_sources:m.limit_sources,source_flag:m.quality_flag,statistical_treatment:"preserved original; excluded from every contrast and statistical summary"}));
 const script="(function(){const root=document.querySelector('.observation-network');const cohort=root.querySelector('#observation-cohort'),characteristic=root.querySelector('#observation-characteristic'),rows=Array.from(root.querySelectorAll('[data-observation-cohort]')),status=root.querySelector('#observation-visible-count');function update(){let n=0;for(const row of rows){row.hidden=Boolean((cohort.value&&row.dataset.observationCohort!==cohort.value)||(characteristic.value&&row.dataset.observationCharacteristic!==characteristic.value));if(!row.hidden)n++;}status.textContent=n+' of '+rows.length+' detailed comparisons shown. Summary tables above always describe the full retained source.';}cohort.addEventListener('change',update);characteristic.addEventListener('change',update);root.querySelector('[data-observation-reset]').addEventListener('click',function(){cohort.value='';characteristic.value='';update();});let open=[],printRows=[];addEventListener('beforeprint',function(){open=Array.from(root.querySelectorAll(':scope > details')).map(x=>[x,x.open]);printRows=rows.map(x=>[x,x.hidden]);for(const x of open)x[0].open=true;for(const x of printRows)x[0].hidden=false;});addEventListener('afterprint',function(){for(const x of open)x[0].open=x[1];for(const x of printRows)x[0].hidden=x[1];open=[];printRows=[];});update();})();";
 const html='<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Three and Twenty Creek — observations in river order</title><style>body{margin:0;background:#fff}main{max-width:1400px;margin:auto;padding:24px}@media(max-width:600px){main{padding:16px}}'+styles+'</style></head><body><main>'+renderSection(body,network,{mapLinks:false,downloadPrefix:"./"})+'</main><script>'+script+'</script></body></html>\n';
 return {
  "network-observation-comparison.json":JSON.stringify(body,null,2)+"\n",
  "network-observation-comparisons.csv":csv(comparisons),
  "network-observation-cohorts.csv":csv(summary(body.cohort_summaries)),
  "network-observation-seasons.csv":csv(summary(body.seasonal_summaries)),
  "network-observation-periods.csv":csv(summary(body.period_summaries)),
  "network-observation-coverage.csv":csv(body.coverage),
  "network-observation-excluded.csv":csv(excluded),
  "network-observation-comparison.html":html
 };
}
