import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {resolve,join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';

export function parseCsv(text) {
  const rows=[];let row=[],cell='',quoted=false;
  for(let i=0;i<text.length;i++){const c=text[i];if(quoted){if(c==='"'&&text[i+1]==='"'){cell+='"';i++;}else if(c==='"')quoted=false;else cell+=c;}
    else if(c==='"')quoted=true;else if(c===','){row.push(cell);cell='';}
    else if(c==='\n'||c==='\r'){if(c==='\r'&&text[i+1]==='\n')i++;row.push(cell);if(row.some(v=>v!==''))rows.push(row);row=[];cell='';}else cell+=c;}
  if(quoted)throw Error('Incomplete CSV quotation');if(row.length||cell){row.push(cell);rows.push(row);}
  const fields=(rows.shift()||[]).map((x,i)=>i===0?x.replace(/^\uFEFF/,''):x);
  if(new Set(fields).size!==fields.length)throw Error('Duplicate CSV field');
  return rows.map(values=>{if(values.length!==fields.length)throw Error('CSV width mismatch');return Object.fromEntries(fields.map((f,i)=>[f,values[i]]));});
}
function csv(rows,fields=Object.keys(rows[0]||{})) {
  const cell=value=>{let s=value===null||value===undefined?'':typeof value==='object'?JSON.stringify(value):String(value);
    if(typeof value==='string'&&/^[\s]*[=+@-]/.test(s))s="'"+s;
    return /[",\r\n]/.test(s)?'"'+s.replaceAll('"','""')+'"':s;};
  return fields.map(cell).join(',')+'\n'+rows.map(r=>fields.map(f=>cell(r[f])).join(',')).join('\n')+(rows.length?'\n':'');
}
function number(value,label){if(value===''||value===null||value===undefined)return null;const n=Number(value);if(!Number.isFinite(n)||n<0)throw Error('Invalid nonnegative '+label);return n;}
function sum(a){let value=0,c=0;for(const x of a){const y=x-c,t=value+y;c=(t-value)-y;value=t;}return value;}
function mean(a){return a.length?sum(a)/a.length:null;}
function median(sorted){const n=sorted.length;return n?n%2?sorted[(n-1)/2]:(sorted[n/2-1]+sorted[n/2])/2:null;}
function quantile(sorted,p){return sorted.length?sorted[Math.max(0,Math.ceil(p*sorted.length)-1)]:null;}
function date(value){if(!/^\d{4}-\d{2}-\d{2}$/.test(value)||new Date(value+'T00:00:00Z').toISOString().slice(0,10)!==value)throw Error('Invalid original date');return value;}
function grouped(rows,key){const groups=new Map;for(const row of rows){const k=key(row);if(!groups.has(k))groups.set(k,[]);groups.get(k).push(row);}return groups;}
function pct(n,d){return d?100*n/d:null;}
function esc(value){return String(value??'—').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');}
function shown(value){return typeof value==='number'?Number.isInteger(value)?String(value):value.toPrecision(5):typeof value==='object'&&value!==null?JSON.stringify(value):value??'—';}
function table(rows,fields){return '<div class="scroll"><table><thead><tr>'+fields.map(f=>'<th>'+esc(f.replaceAll('_',' '))+'</th>').join('')+'</tr></thead><tbody>'+rows.map(r=>'<tr>'+fields.map(f=>'<td>'+esc(shown(r[f]))+'</td>').join('')+'</tr>').join('')+'</tbody></table></div>';}
function interval(r) {
  const value=number(r.value,'result'),limit=number(r.limit_value,'detection limit'),condition=r.detection_condition;
  if(value!==null&&!condition&&r.unit==='mg/L')return {state:'reported_numeric',lower:value,upper:value,upper_open:false};
  if(value===null&&condition==='Present Below Quantification Limit'&&limit!==null&&r.limit_unit==='mg/L')return {state:'left_censored',lower:0,upper:limit,upper_open:true};
  return {state:'unresolved_original',lower:null,upper:null,upper_open:null};
}
function summarizeCoverage(station,period,days,activities) {
  const sampled=new Set(activities.map(r=>r.date)),q=sum(days.map(r=>r.q)),high=days.filter(r=>r.extreme),highQ=sum(high.map(r=>r.q));
  const observed=days.filter(r=>sampled.has(r.date)),highObserved=high.filter(r=>sampled.has(r.date));
  return {station_id:station,period,daily_records:days.length,activities:activities.length,sampled_dates:sampled.size,
    sample_day_percent:pct(sampled.size,days.length),calendar_mean_cfs:mean(days.map(r=>r.q)),maximum_cfs:days.length?Math.max(...days.map(r=>r.q)):null,
    sampled_maximum_cfs:observed.length?Math.max(...observed.map(r=>r.q)):null,
    extreme_flow_days:high.length,extreme_sampled_dates:highObserved.length,extreme_day_capture_percent:pct(highObserved.length,high.length),
    extreme_flow_volume_percent:pct(highQ,q),sampled_dates_flow_volume_percent:pct(sum(observed.map(r=>r.q)),q),
    sampled_extreme_volume_percent:pct(sum(highObserved.map(r=>r.q)),highQ),
    sampled_months:new Set(activities.map(r=>r.date.slice(0,7))).size,
    provisional_days:days.filter(r=>r.qualifiers.split('|').includes('P')).length,
    estimated_days:days.filter(r=>r.qualifiers.split('|').includes('e')).length,
    first_sample_date:[...sampled].sort()[0]||null,last_sample_date:[...sampled].sort().at(-1)||null};
}
function durationSvg(years,activities) {
  const marks=[],width=1000,height=years.length*210+55;
  for(const [i,[year,days]] of years.entries()){
    const sorted=days.map(r=>r.q).sort((a,b)=>b-a),top=35+i*210,cap=Math.max(...sorted),sampled=new Set(activities.filter(r=>r.date.startsWith(year)).map(r=>r.date));
    const x=p=>75+880*p/100,y=q=>top+155-145*Math.log1p(q)/Math.log1p(cap);
    const path=sorted.map((q,j)=>(j?'L':'M')+x(100*(j+.5)/sorted.length).toFixed(2)+','+y(q).toFixed(2)).join(' ');
    marks.push('<g><text x="15" y="'+(top+18)+'">'+year+'</text><path d="M75 '+top+'V'+(top+155)+'H955" fill="none" stroke="#bbb"/><path d="'+path+'" fill="none" stroke="#555" stroke-width="1.4"/>');
    for(const r of days.filter(r=>sampled.has(r.date))){
      const p=100-r.flow_percentile;
      marks.push('<circle cx="'+x(p).toFixed(2)+'" cy="'+y(r.q).toFixed(2)+'" r="3.2" fill="#111"><title>'+esc(r.date+' · '+r.q+' cfs · '+r.qualifiers)+'</title></circle>');
    }
    for(const tick of [0,50,100])marks.push('<text x="'+x(tick)+'" y="'+(top+173)+'" text-anchor="middle" font-size="10">'+tick+'%</text>');
    for(const q of [0,cap])marks.push('<text x="70" y="'+(y(q)+4)+'" text-anchor="end" font-size="10">'+esc(shown(q))+'</text>');
    marks.push('</g>');
  }
  return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 '+width+' '+height+'" role="img" aria-label="Daily flow duration with actual unique nutrient sampling dates"><rect width="100%" height="100%" fill="white"/><g font-family="Arial,sans-serif" fill="#222">'+marks.join('')+'<text x="520" y="'+(height-12)+'" text-anchor="middle" font-size="12">Exceedance rank of daily mean flow · vertical position log(1 + cfs) · points are sampled dates</text></g></svg>';
}
export function analyzeStreamFlow(input) {
  const values=parseCsv(input.nutrients),stations=parseCsv(input.stations),dailyAll=parseCsv(input.daily),originals=input.originals||{};
  const stationIds=[...new Set(values.map(r=>r.station_id))].sort(),stationMap=new Map(stations.map(r=>[r.station_id,r]));
  const flow=dailyAll.filter(r=>r.site==='02186702').map(r=>({...r,date:date(r.date),q:number(r.reported_mean_cfs,'daily flow')}));
  if(flow.some(r=>r.q===null))throw Error('Missing numeric original gauge flow');
  flow.sort((a,b)=>a.date.localeCompare(b.date));const byDate=new Map(flow.map(r=>[r.date,r]));
  if(byDate.size!==flow.length)throw Error('Duplicate gauge date');
  const calendar=grouped(flow,r=>r.date.slice(0,4)),thresholds=[];
  for(const [year,days] of calendar){
    const expected=(Date.parse((+year+1)+'-01-01')-Date.parse(year+'-01-01'))/86400000;
    if(days.length!==expected||days[0].date!==year+'-01-01'||days.at(-1).date!==year+'-12-31')throw Error('Incomplete original gauge calendar year '+year);
    const sorted=days.map(r=>r.q).sort((a,b)=>a-b),p10=quantile(sorted,.1),p90=quantile(sorted,.9),p95=quantile(sorted,.95);
    thresholds.push({year,days:days.length,p10_cfs:p10,p90_cfs:p90,p95_cfs:p95,threshold_method:'Empirical nearest-rank quantile; ties included'});
    for(const row of days){const less=sorted.filter(v=>v<row.q).length,equal=sorted.filter(v=>v===row.q).length;row.flow_percentile=100*(less+.5*equal)/sorted.length;
      row.flow_stratum=row.q>=p95?'extreme_p95':row.q>=p90?'high_p90_p95':row.q<=p10?'low_p10':'middle_p10_p90';row.extreme=row.q>=p95;}
  }
  const enriched=[];
  for(const [index,r] of values.entries()){
    const sourceRows=originals[r.source_file],original=sourceRows?.[Number(r.source_row)-2];
    if(!original||original.ActivityIdentifier!==r.activity_id||original.MonitoringLocationIdentifier!==r.station_id||original.CharacteristicName!==r.characteristic||
       original.ResultMeasureValue!==r.value||original['ResultMeasure/MeasureUnitCode']!==r.unit)throw Error('Normalized result no longer binds its exact source row: '+r.source_file+':'+r.source_row);
    const f=byDate.get(date(r.date)),iv=interval(r),station=stationMap.get(r.station_id);
    if(!f||!station)throw Error('Original sampling date/station has no retained context');
    enriched.push({...r,record_id:r.source_file+"#row-"+r.source_row,project_id:original.ProjectIdentifier,activity_type:original.ActivityTypeCode,media:original.ActivityMediaName,
      context_row:index+2,interval_state:iv.state,quantitation_class:iv.state==='left_censored'?'censored_below':iv.state==='reported_numeric'?'quantified':'unresolved',observation_unit:r.unit||(iv.state==='left_censored'?r.limit_unit:''),concentration_lower_mg_l:iv.lower,concentration_upper_mg_l:iv.upper,upper_endpoint_open:iv.upper_open,
      flow_gauge:'02186702',same_date_mean_cfs:f.q,annual_flow_percentile:f.flow_percentile,annual_flow_stratum:f.flow_stratum,
      flow_qualifiers:f.qualifiers,flow_method_id:f.method_id,flow_source_id:f.source_id,
      flow_source_values_index:Number(f.source_values_index),flow_source_record_index:Number(f.source_record_index),
      flow_location_role:'regional_daily_context',gauge_split_basin_relation:station.gauge_split_basin_relation||'not_supplied',
      gauge_network_relation:station.gauge_network_relation||'not_supplied',
      station_network_comid:station.station_network_comid||null,station_network_reachcode:station.station_network_reachcode||null,
      station_network_measure:station.station_network_measure||null,gauge_network_comid:station.gauge_network_comid||null,
      gauge_network_reachcode:station.gauge_network_reachcode||null,gauge_network_measure:station.gauge_network_measure||null});
  }
  const activityGroups=grouped(enriched,r=>[r.station_id,r.activity_id,r.project_id].join('|')),activities=[],components=[],inconsistencies=[];
  for(const [key,rows] of activityGroups){
    const first=rows[0];if(rows.some(r=>r.date!==first.date||r.time!==first.time||r.time_zone!==first.time_zone))throw Error('Activity date/time differs within source group '+key);
    const a={station_id:first.station_id,activity_id:first.activity_id,project_id:first.project_id,date:first.date,time:first.time,time_zone:first.time_zone,
      result_rows:rows.length,characteristics:[...new Set(rows.map(r=>r.characteristic))].sort(),censored_results:rows.filter(r=>r.interval_state==='left_censored').length,
      flow_gauge:first.flow_gauge,same_date_mean_cfs:first.same_date_mean_cfs,annual_flow_percentile:first.annual_flow_percentile,
      annual_flow_stratum:first.annual_flow_stratum,flow_qualifiers:first.flow_qualifiers,flow_source_id:first.flow_source_id,
      flow_source_values_index:first.flow_source_values_index,flow_source_record_index:first.flow_source_record_index,
      full_reach_basin_relation:first.full_reach_basin_relation,gauge_split_basin_relation:first.gauge_split_basin_relation,
      gauge_network_relation:first.gauge_network_relation,station_network_comid:first.station_network_comid,
      station_network_reachcode:first.station_network_reachcode,station_network_measure:first.station_network_measure,
      gauge_network_comid:first.gauge_network_comid,gauge_network_reachcode:first.gauge_network_reachcode,gauge_network_measure:first.gauge_network_measure,
      source_references:rows.map(r=>({file:r.source_file,row:Number(r.source_row),characteristic:r.characteristic}))};
    activities.push(a);
    const eligible=name=>rows.filter(r=>r.characteristic===name&&r.sample_fraction==='Unfiltered'&&r.media==='Water'&&r.result_status==='Final');
    const tkn=eligible('Kjeldahl nitrogen'),nox=eligible('Nitrate + Nitrite'),reported=eligible('Nitrogen');
    const exact=tkn.length===1&&nox.length===1,t=exact?tkn[0]:null,n=exact?nox[0]:null;
    const resolved=exact&&t.concentration_lower_mg_l!==null&&n.concentration_lower_mg_l!==null;
    const lower=resolved?t.concentration_lower_mg_l+n.concentration_lower_mg_l:null,upper=resolved?t.concentration_upper_mg_l+n.concentration_upper_mg_l:null;
    const c={station_id:first.station_id,activity_id:first.activity_id,project_id:first.project_id,date:first.date,
      component_status:!exact?'ambiguous_or_missing_components':resolved?'paired_source_intervals':'unresolved_units_or_detection',
      component_definition:'Unfiltered same-activity TKN plus nitrate/nitrite, using original mg/L method basis',
      component_lower_mg_l:lower,component_upper_mg_l:upper,component_upper_open:resolved?(t.upper_endpoint_open||n.upper_endpoint_open):null,
      numeric_component_sum_mg_l:resolved&&t.interval_state==='reported_numeric'&&n.interval_state==='reported_numeric'?lower:null,
      tkn_method_id:t?.method_id||null,nox_method_id:n?.method_id||null,
      tkn_source_file:t?.source_file||null,tkn_source_row:t?Number(t.source_row):null,nox_source_file:n?.source_file||null,nox_source_row:n?Number(n.source_row):null,
      original_reported_nitrogen_rows:reported.length,same_date_mean_cfs:first.same_date_mean_cfs,annual_flow_stratum:first.annual_flow_stratum};
    components.push(c);
    for(const r of reported){
      const reportedValue=number(r.value,'reported calculated nitrogen'),tolerance=1e-12*Math.max(1,Math.abs(reportedValue||0),Math.abs(lower||0),Math.abs(upper||0));
      const state=reportedValue===null||!resolved?'unresolved_component_check':reportedValue<lower-tolerance?'below_component_interval':reportedValue>upper+tolerance?'above_component_interval':c.component_upper_open&&Math.abs(reportedValue-upper)<=tolerance?'at_open_upper_boundary':'within_component_interval';
      inconsistencies.push({...c,reported_characteristic:r.characteristic,reported_nitrogen_value:reportedValue,reported_nitrogen_unit:r.unit,
        reported_result_type:r.result_type,reported_method_id:r.method_id,reported_limit:r.limit_value,reported_limit_unit:r.limit_unit,
        reported_source_file:r.source_file,reported_source_row:Number(r.source_row),source_consistency:state,
        difference_from_component_lower:reportedValue!==null&&lower!==null?reportedValue-lower:null,
        source_values_preserved:true});
    }
  }
  activities.sort((a,b)=>a.date.localeCompare(b.date)||a.station_id.localeCompare(b.station_id));
  const network=[],stationYears=[],months=[];
  for(const [year,days] of calendar){
    const acts=activities.filter(r=>r.date.startsWith(year));network.push(summarizeCoverage('ALL_FOUR_STATIONS',year,days,acts));
    for(const station of stationIds)stationYears.push(summarizeCoverage(station,year,days,acts.filter(r=>r.station_id===station)));
    for(let month=1;month<=12;month++){const period=year+'-'+String(month).padStart(2,'0'),monthly=days.filter(r=>r.date.startsWith(period)),sample=acts.filter(r=>r.date.startsWith(period));
      for(const station of ['ALL_FOUR_STATIONS',...stationIds])months.push(summarizeCoverage(station,period,monthly,station==='ALL_FOUR_STATIONS'?sample:sample.filter(r=>r.station_id===station)));}
  }
  const concentrations=[];
  for(const [key,rows] of grouped(enriched,r=>[r.station_id,r.characteristic,r.sample_fraction,r.annual_flow_stratum].join('|'))){
    const f=rows[0],resolved=rows.filter(r=>r.concentration_lower_mg_l!==null),numeric=rows.filter(r=>r.interval_state==='reported_numeric'),sampledates=new Set(rows.map(r=>r.date));
    concentrations.push({station_id:f.station_id,characteristic:f.characteristic,sample_fraction:f.sample_fraction,annual_flow_stratum:f.annual_flow_stratum,
      result_rows:rows.length,sampled_dates:sampledates.size,numeric_rows:numeric.length,censored_rows:rows.filter(r=>r.interval_state==='left_censored').length,
      unresolved_rows:rows.length-resolved.length,interval_mean_lower_mg_l:resolved.length===rows.length?mean(resolved.map(r=>r.concentration_lower_mg_l)):null,
      interval_mean_upper_mg_l:resolved.length===rows.length?mean(resolved.map(r=>r.concentration_upper_mg_l)):null,
      any_open_upper_endpoint:resolved.some(r=>r.upper_endpoint_open),numeric_only_median_mg_l:median(numeric.map(r=>Number(r.value)).sort((a,b)=>a-b)),
      first_date:[...sampledates].sort()[0],last_date:[...sampledates].sort().at(-1)});
  }
  const episodes=[];let pending=[];
  const finish=()=>{if(!pending.length)return;const dates=new Set(pending.map(r=>r.date)),sample=activities.filter(r=>dates.has(r.date)),stations=[...new Set(sample.map(r=>r.station_id))].sort();
    episodes.push({event_id:'Q95-'+pending[0].date,start_date:pending[0].date,end_date:pending.at(-1).date,days:pending.length,
      peak_cfs:Math.max(...pending.map(r=>r.q)),sum_daily_mean_cfs:sum(pending.map(r=>r.q)),sampled_dates:new Set(sample.map(r=>r.date)).size,
      station_activities:sample.length,sampled_stations:stations,missing_stations:stationIds.filter(s=>!stations.includes(s)),
      daily_source_references:pending.map(r=>({date:r.date,source_id:r.source_id,source_values_index:Number(r.source_values_index),source_record_index:Number(r.source_record_index),qualifiers:r.qualifiers}))});pending=[];};
  for(const row of flow){if(!row.extreme){finish();continue;}if(pending.length&&(Date.parse(row.date)-Date.parse(pending.at(-1).date)!==86400000||row.date.slice(0,4)!==pending[0].date.slice(0,4)))finish();pending.push(row);}finish();
  const summary={schema:'upstate.stream-flow-coverage/v1',gauge_id:'02186702',period_start:flow[0].date,period_end:flow.at(-1).date,
    result_rows:enriched.length,station_activities:activities.length,unique_sampling_dates:new Set(activities.map(r=>r.date)).size,
    gauge_daily_records:flow.length,stations:stationIds,complete_calendar_years:calendar.size,
    numeric_results:enriched.filter(r=>r.interval_state==='reported_numeric').length,censored_results:enriched.filter(r=>r.interval_state==='left_censored').length,
    unresolved_results:enriched.filter(r=>r.interval_state==='unresolved_original').length,
    paired_component_rows:components.filter(r=>r.component_status==='paired_source_intervals').length,
    reported_nitrogen_rows:inconsistencies.length,component_open_boundary_rows:inconsistencies.filter(r=>r.source_consistency==='at_open_upper_boundary').length,component_inconsistencies:inconsistencies.filter(r=>/^(below|above)_/.test(r.source_consistency)).length,
    extreme_flow_episodes:episodes.length,unsampled_extreme_episodes:episodes.filter(r=>r.sampled_dates===0).length,
    source_daily_qualifiers:[...new Set(flow.map(r=>r.qualifiers))].sort(),thresholds,network_years:network,
    method:{daily_join:'Same original reporting date; USGS daily mean is flow context for these original sampling locations.',
      geometry:'Whole-reach polygon, original NLDI network relation, and gauge-specific split polygon remain separate. Same-reach source measures run from zero downstream to one hundred upstream. The original source-network relation is retained when supplied.',
      detection:'Reported numeric values are unchanged. Present Below Quantification Limit is represented by [0, original limit), with no limit substitution.',
      chemistry:'Same-activity unfiltered TKN plus nitrate/nitrite is a separate component-sum diagnostic. Original calculated Nitrogen values remain separate; source method identifiers and mass-basis qualification are retained.',
      weighting:'Coverage uses unique station-date or network-date sets; nutrient rows do not multiply a sampled day. Flow-volume shares sum equal-duration original daily means.',
      quantiles:'Nearest-rank annual thresholds; >=P95 defines extreme days, ties retained. Percentiles use midrank including equal daily means.',
      concentration:'Interval means describe the retained samples within each flow stratum; no temporal interpolation or annual-load integration is performed.',
      event:'Consecutive original >=annualP95 days; episodes split at calendar-year boundaries because thresholds differ.'}};
  const files={
    'activity-flow.csv':csv(activities),'nutrient-flow.csv':csv(enriched),'nitrogen-components.csv':csv(components),
    'component-consistency.csv':csv(inconsistencies),'network-year-flow-coverage.csv':csv(network),'station-year-flow-coverage.csv':csv(stationYears),
    'monthly-flow-coverage.csv':csv(months),'flow-stratum-concentrations.csv':csv(concentrations),'high-flow-episodes.csv':csv(episodes),
    'flow-thresholds.csv':csv(thresholds),'analysis-summary.json':JSON.stringify(summary,null,2)+'\n',
    'flow-duration.svg':durationSvg([...calendar],activities)};
  const links=Object.keys(files).map(name=>'<li><a href="'+esc(name)+'">'+esc(name)+'</a></li>').join('');
  const mapNotes=stations.filter(r=>stationIds.includes(r.station_id)).map(r=>({station_id:r.station_id,description:r.description,latitude:r.latitude,longitude:r.longitude,
    datum:r.datum,full_reach_basin_relation:r.full_reach_basin_relation,gauge_split_basin_relation:r.gauge_split_basin_relation||'not supplied',
    gauge_network_relation:r.gauge_network_relation||'not supplied',station_network_comid:r.station_network_comid||null,
    station_network_measure:r.station_network_measure||null,gauge_network_measure:r.gauge_network_measure||null,
    network_station_source:r.network_station_source||null,network_gauge_source:r.network_gauge_source||null}));
  files['report.html']='<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Eighteenmile stream sampling and flow coverage</title><style>body{font:15px Arial,sans-serif;color:#222;background:#fff;max-width:1180px;margin:auto;padding:32px;line-height:1.5}h1{font-size:30px;line-height:1.15}h2{margin-top:38px;border-top:1px solid #999;padding-top:22px}a{color:inherit}table{border-collapse:collapse;width:100%;font-size:12px}th,td{padding:8px;border-bottom:1px solid #ccc;text-align:left;vertical-align:top}th{background:#eee}.scroll{overflow:auto}.cards{display:flex;flex-wrap:wrap;gap:15px}.card{border:1px solid #aaa;padding:16px;min-width:160px}.card strong{display:block;font-size:25px}svg{width:100%;height:auto}code{overflow-wrap:anywhere}details{margin:18px 0}@media print{body{font-size:10pt;padding:0}.scroll{overflow:visible}table{font-size:8pt}h2{break-after:avoid}thead{display:table-header-group}a{color:#222}}</style></head><body><header><p>UPPER SAVANNAH · ORIGINAL STREAM OBSERVATIONS</p><h1>Eighteenmile stream sampling and flow coverage, 2020–2025</h1><p>Original South Carolina nutrient results joined to the retained USGS 02186702 daily means. Source rows, detection limits, method identifiers, and USGS qualifiers remain available in the linked tables.</p></header><div class="cards">'+[['Results',enriched.length],['Station activities',activities.length],['Distinct dates',summary.unique_sampling_dates],['Gauge days',flow.length]].map(([label,value])=>'<div class="card">'+esc(label)+'<strong>'+value+'</strong></div>').join('')+'</div><h2>Annual coverage and high flow</h2><p>Extreme days meet or exceed each calendar year’s empirical 95th-percentile daily flow. The water-volume share describes recorded gauge discharge on those days. A sampled-day share reports calendar coverage and does not integrate concentrations between samples.</p>'+table(network,['period','activities','sampled_dates','extreme_flow_days','extreme_sampled_dates','extreme_flow_volume_percent','sampled_dates_flow_volume_percent','provisional_days'])+'<h2>Flow ranges represented by actual sampling dates</h2><p>The line contains every daily mean; dark points mark unique dates with at least one stream sample. The vertical axis uses log(1+cfs) to retain low and peak flows. Exact values are in the linked tables.</p>'+files['flow-duration.svg']+'<h2>Source chemical consistency</h2><p>The separately retained component diagnostic adds same-activity unfiltered Kjeldahl nitrogen and nitrate/nitrite, conditional on their shared nitrogen method basis. EPA describes that chemical relationship. All original calculated Nitrogen values remain unchanged. '+summary.component_inconsistencies+' of '+inconsistencies.length+' original Nitrogen rows fall outside the paired component ranges; laboratory or agency interpretation can use the exact method and record links.</p>'+table(inconsistencies,['station_id','date','reported_nitrogen_value','reported_nitrogen_unit','component_lower_mg_l','component_upper_mg_l','source_consistency','reported_source_file','reported_source_row'])+'<h2>Detection limits and flow-stratum concentrations</h2><p>'+summary.censored_results+' results report presence below quantification. Their original limits provide open upper endpoints, while zero is a conservative lower endpoint. The table gives the range of arithmetic sample means within each flow stratum. Numeric-only medians use only measured numeric rows and the midpoint of the two central numeric values for an even sample count. These descriptive summaries retain unequal sampling and changing methods rather than filling unobserved days.</p>'+table(concentrations,['station_id','characteristic','annual_flow_stratum','result_rows','numeric_rows','censored_rows','interval_mean_lower_mg_l','interval_mean_upper_mg_l','numeric_only_median_mg_l'])+'<h2>Station and catchment interpretation</h2><p>All four source points were evaluated against the original whole-reach NLDI basin. That response uses splitCatchment=false. Original NLDI network relations use separately retained hydrolocations and gauge linear references. Same-reach measure values increase upstream, so a lower station measure identifies downstream position. The station table retains that source relationship separately from whole-reach membership. A gauge-specific split polygon remains a distinct geometry. Daily flow is labeled regional context for each original stream location.</p>'+table(mapNotes,['station_id','description','latitude','longitude','datum','full_reach_basin_relation','gauge_network_relation','station_network_comid','station_network_measure','gauge_network_measure','gauge_split_basin_relation'])+'<h2>Sampling gaps to address</h2><p>'+summary.unsampled_extreme_episodes+' of '+summary.extreme_flow_episodes+' observed extreme-flow episodes contained no sampling date in this four-station cohort. Use the event table to examine exact dates, source qualifiers, and station coverage. The monthly and station/year tables retain unsampled years and months instead of silently limiting denominators to active sampling periods.</p><p>Future sampling design can emphasize each station’s uncovered high-flow and seasonal strata, while maintaining the original routine schedule for comparable low and median conditions. The event list describes historical coverage rather than forecasting events.</p><details><summary>Complete station/year coverage</summary>'+table(stationYears,['station_id','period','activities','sampled_dates','extreme_sampled_dates','sampled_months','first_sample_date','last_sample_date'])+'</details><h2>Complete retained analysis</h2><ul>'+links+'<li><a href="input-manifest.json">Exact original and maintained-source identities</a></li><li><a href="README.md">Reproduction and scientific methods</a></li></ul><h2>Primary method sources</h2><p><a href="https://echo.epa.gov/trends/loading-tool/resources/technical-background-methodology/nutrient-aggregation">EPA nitrogen component relationship and chemical mass-basis distinctions</a> · <a href="https://waterdata.usgs.gov/monitoring-location/USGS-02186702/">Original USGS gauge</a> · <a href="https://www.waterqualitydata.us/">Original Water Quality Portal</a></p></body></html>\n';
  return {summary,files};
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const directory=dirname(fileURLToPath(import.meta.url)),root=resolve(process.argv[2]||join(directory,'../../..')),output=resolve(process.argv[3]||directory);
  const manifest=JSON.parse(readFileSync(join(directory,'input-manifest.json'),'utf8')),texts={};
  for(const item of manifest.inputs){
    if(!/^[a-zA-Z0-9_./-]+$/.test(item.path)||item.path.split('/').includes('..')||item.path.startsWith('/'))throw Error('Invalid source member path');
    const bytes=readFileSync(join(root,item.path));
    if(bytes.length!==item.bytes||createHash('sha256').update(bytes).digest('hex')!==item.sha256)throw Error('Original input changed: '+item.path);
    texts[item.role]=bytes.toString('utf8');
  }
  const originals={'original/nutrient-results-2020-2022.csv':parseCsv(texts.original_2020_2022),'original/nutrient-results-2023-2025.csv':parseCsv(texts.original_2023_2025)};
  const result=analyzeStreamFlow({nutrients:texts.nutrients,stations:texts.stations,daily:texts.daily,originals});
  mkdirSync(output,{recursive:true});for(const [name,content] of Object.entries(result.files))writeFileSync(join(output,name),content,'utf8');
  if(output!==directory)for(const name of ['input-manifest.json','README.md','model-sources.json','analyze-stream-flow.mjs','import_into_workspace.py','render_flow_figures.py'])writeFileSync(join(output,name),readFileSync(join(directory,name)));
  process.stdout.write(JSON.stringify(result.summary,null,2)+'\n');
}
