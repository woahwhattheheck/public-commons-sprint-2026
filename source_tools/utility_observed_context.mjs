/** Original observed sampling context for retained utility planning selections. */
export const VERSION = "1.0.0";
export function parseCsv(text) {
  const rows=[];let row=[],cell="",quoted=false;
  for(let i=0;i<text.length;i++){const c=text[i];if(quoted){if(c==='"'){if(text[i+1]==='"'){cell+='"';i++;}else quoted=false;}else cell+=c;}else if(c==='"')quoted=true;else if(c===","){row.push(cell);cell="";}else if(c==="\n"||c==="\r"){if(c==="\r"&&text[i+1]==="\n")i++;row.push(cell);rows.push(row);row=[];cell="";}else cell+=c;}
  if(quoted)throw Error("The retained CSV has an unclosed quote");
  if(cell||row.length){row.push(cell);rows.push(row);}
  const header=rows.shift();if(!header)throw Error("The retained CSV has no header");
  header[0]=header[0].replace(/^\uFEFF/,"");
  if(new Set(header).size!==header.length)throw Error("The source repeats a column");
  return rows.filter(r=>r.some(c=>c!=="")).map((r,i)=>{if(r.length!==header.length)throw Error("Source CSV width differs at row "+(i+2));return Object.fromEntries(header.map((k,j)=>[k,r[j]]));});
}
const distinct=values=>[...new Set(values)].sort();
const number=(text,label)=>{if(String(text).trim()==="")return null;const n=Number(text);if(!Number.isFinite(n)||n<0)throw Error("Retain a nonnegative source number: "+label);return n;};
const countBy=(rows,key)=>Object.fromEntries(distinct(rows.map(key)).map(k=>[k,rows.filter(r=>key(r)===k).length]));
const median=values=>{const a=[...values].sort((a,b)=>a-b);return a.length?(a[Math.floor((a.length-1)/2)]+a[Math.floor(a.length/2)])/2:null;};
const copy=value=>JSON.parse(JSON.stringify(value));
function membership(point,rings) {
  let inside=false,boundary=false;
  for(const ring of rings){for(let i=0,j=ring.length-1;i<ring.length;j=i++){
    const a=ring[j],b=ring[i],cross=(point[1]-a[1])*(b[0]-a[0])-(point[0]-a[0])*(b[1]-a[1]);
    if(Math.abs(cross)<1e-12&&point[0]>=Math.min(a[0],b[0])&&point[0]<=Math.max(a[0],b[0])&&point[1]>=Math.min(a[1],b[1])&&point[1]<=Math.max(a[1],b[1]))boundary=true;
    if((a[1]>point[1])!==(b[1]>point[1])&&point[0]<(b[0]-a[0])*(point[1]-a[1])/(b[1]-a[1])+a[0])inside=!inside;
  }}
  return {inside,boundary};
}
function sampleCoverage(rows) {
  const dates=distinct(rows.map(r=>r.date));
  return {records:rows.length,activities:distinct(rows.map(r=>r.station_id+"|"+r.activity_id)).length,
    stations:distinct(rows.map(r=>r.station_id)).length,unique_dates:dates.length,
    first_date:dates[0]||null,last_date:dates.at(-1)||null,observed_months:distinct(dates.map(d=>d.slice(0,7))),
    activity_types:countBy(rows,r=>r.activity_type),source_units:distinct(rows.map(r=>r.unit).filter(Boolean)),
    limit_units:distinct(rows.map(r=>r.limit_unit).filter(Boolean)),detection_status:countBy(rows,r=>r.status),
    information_only_records:rows.filter(r=>r.information_only).length,
    records_with_source_comments:rows.filter(r=>r.has_comments).length};
}
function numericStats(rows) {
  const values=rows.filter(r=>r.status==="measured").map(r=>r.value);
  return {measured_count:values.length,minimum:values.length?Math.min(...values):null,
    median:median(values),maximum:values.length?Math.max(...values):null,
    basis:"Only original numeric measured results in this exact station/year/method/activity/unit group; censored and missing results retain separate counts."};
}
function stationGroups(rows) {
  const keys=r=>[r.station_id,r.year,r.method_context,r.method,r.activity_type,r.unit||r.limit_unit].join("|");
  return distinct(rows.map(keys)).map(key=>{
    const selected=rows.filter(r=>keys(r)===key),a=selected[0],without=selected.filter(r=>!r.information_only);
    return {station_id:a.station_id,year:a.year,method_context:a.method_context,method:a.method,
      activity_type:a.activity_type,source_unit:a.unit||a.limit_unit,...sampleCoverage(selected),
      measured:numericStats(selected),excluding_information_only:{...sampleCoverage(without),measured:numericStats(without)},
      original_row_references:selected.map(r=>({source_file:r.source_file,source_row:r.source_row,activity_id:r.activity_id,date:r.date}))};
  });
}
function microbialRecords(rows,stations) {
  const by=new Map(stations.map(s=>[s.station_id,s]));
  if(by.size!==stations.length)throw Error("The original station membership repeats an identifier");
  const seen=new Set();
  return rows.map(r=>{
    const station=by.get(r.MonitoringLocationIdentifier);
    if(!station||station.utility_id!==r.utility_id)throw Error("Observation and original utility membership differ");
    if(r.CharacteristicName!=="Escherichia coli")throw Error("The selected microbial cohort has another constituent");
    const value=number(r.ResultMeasureValue,"microbial result"),limit=number(r["DetectionQuantitationLimitMeasure/MeasureValue"],"microbial limit");
    const condition=r.ResultDetectionConditionText;
    const statuses={"Present Above Quantification Limit":"above_limit","Present Below Quantification Limit":"below_limit","Not Detected":"not_detected","Not Reported":"not_reported"};
    if(condition&&(!(condition in statuses)||value!==null))throw Error("Retain and resolve the original detection/value condition");
    const status=condition?statuses[condition]:value===null?"missing":"measured";
    const unit=r["ResultMeasure/MeasureUnitCode"],limitUnit=r["DetectionQuantitationLimitMeasure/MeasureUnitCode"];
    if([unit,limitUnit].some(u=>u&&!["MPN/100mL","MPN/100 ml"].includes(u))||(value!==null&&!unit))throw Error("The source uses a different or absent microbial unit");
    const identity=r.source_file+"|"+r.source_row;if(seen.has(identity))throw Error("The source repeats an original record");seen.add(identity);
    if(!/^\d{4}-\d{2}-\d{2}$/.test(r.ActivityStartDate))throw Error("Retain the original sampling date");
    const comments=[r.ResultCommentText,r.ActivityCommentText,r.ResultLaboratoryCommentText];
    return {utility_id:r.utility_id,station_id:r.MonitoringLocationIdentifier,activity_id:r.ActivityIdentifier,
      date:r.ActivityStartDate,year:r.ActivityStartDate.slice(0,4),activity_type:r.ActivityTypeCode,
      method:r["ResultAnalyticalMethod/MethodIdentifier"],method_context:r["ResultAnalyticalMethod/MethodIdentifierContext"],
      value,unit,limit_value:limit,limit_unit:limitUnit,limit_type:r.DetectionQuantitationLimitTypeName,status,
      information_only:/info(?:r)?mation only/i.test(r.ResultCommentText),has_comments:comments.some(Boolean),
      source_file:r.source_file,source_row:Number(r.source_row)};
  });
}
export function buildUtilityObservedContext(input) {
  const utility=input.utilityContext,profile=input.profile,ar=input.arjwsGeometry;
  if(utility.schema!=="upstate.utility-source-context/v1"||profile.schema!=="upstate.receptor-spec/v1")throw Error("Select the retained utility/profile editions");
  if(ar.spatialReference?.wkid!==4326||ar.exceededTransferLimit)throw Error("Use the complete original EPSG4326 ARJWS polygons");
  const stations=parseCsv(input.microbialStations),records=microbialRecords(parseCsv(input.microbialResults),stations);
  const arUtility=utility.utilities.find(u=>u.utility_id==="ARJWS"),prUtility=utility.utilities.find(u=>u.utility_id==="PRWD");
  if(!arUtility||!prUtility)throw Error("Retain both original utility selections");
  for(const u of utility.utilities){
    const p=profile.receptors.find(p=>(p.utility_id||p.id)===u.utility_id);
    if(!p||JSON.stringify([...p.anchor_huc12s].sort())!==JSON.stringify([...u.anchor_huc12s].sort()))throw Error("Utility anchors differ from their original profile");
  }
  const arIds=arUtility.rows.map(r=>r.huc12),prIds=prUtility.rows.map(r=>r.huc12);
  if(ar.features.length!==arIds.length||ar.features.some(f=>!arIds.includes(f.attributes.huc12)))throw Error("Original ARJWS polygons differ from the utility selection");
  if(prIds.some(h=>!h.startsWith("03060102")))throw Error("The retained Pioneer selection is a different geography");
  const streamStations=parseCsv(input.streamStations).map(s=>{
    if(s.datum!=="WGS84")throw Error("Transform the original stream station datum before its geographic join");
    const p=[Number(s.longitude),Number(s.latitude)];
    if(!p.every(Number.isFinite))throw Error("Retain original numeric station coordinates");
    const matches=ar.features.map(f=>({huc12:f.attributes.huc12,...membership(p,f.geometry.rings)})).filter(x=>x.inside||x.boundary);
    return {...s,arjws_huc12_relations:matches,
      arjws_scope:matches.length?(matches.some(x=>x.boundary)?"boundary_context":"inside_original_utility_polygons"):"outside_original_utility_polygons",
      prwd_scope:s.original_huc8==="03060102"?"publisher_huc8_matches_original_utility_union":"publisher_huc8_outside_original_utility_union"};
  });
  const nutrientRows=parseCsv(input.nutrientFlow);
  const streamIds=new Set(streamStations.map(s=>s.station_id));
  if(nutrientRows.some(r=>!streamIds.has(r.station_id)))throw Error("A nutrient record lacks its original geographic support");
  const nutrientKey=r=>[r.station_id,r.characteristic,r.sample_fraction,r.method_context,r.method_id,r.result_type,r.observation_unit].join("|");
  const nutrients=distinct(nutrientRows.map(nutrientKey)).map(key=>{
    const rows=nutrientRows.filter(r=>nutrientKey(r)===key),a=rows[0],dates=distinct(rows.map(r=>r.date));
    return {station_id:a.station_id,characteristic:a.characteristic,sample_fraction:a.sample_fraction,
      method_id:a.method_id,method_context:a.method_context,result_type:a.result_type,observation_unit:a.observation_unit,
      records:rows.length,activities:distinct(rows.map(r=>r.activity_id)).length,unique_dates:dates.length,
      first_date:dates[0],last_date:dates.at(-1),quantitation_classes:countBy(rows,r=>r.quantitation_class),
      original_units:distinct(rows.map(r=>r.unit)),original_limit_units:distinct(rows.map(r=>r.limit_unit)),
      observed_years:distinct(dates.map(d=>d.slice(0,4))),flow_location_roles:distinct(rows.map(r=>r.flow_location_role))};
  });
  const query=JSON.parse(input.microbialOriginalSources).selection;
  const start=query.activity_start_inclusive,end=query.activity_end_inclusive;
  if(!/^\d{4}-\d{2}-\d{2}$/.test(start)||!/^\d{4}-\d{2}-\d{2}$/.test(end)||start>end||records.some(r=>r.date<start||r.date>end))throw Error("Original observations differ from their queried period");
  const years=Array.from({length:Number(end.slice(0,4))-Number(start.slice(0,4))+1},(_,i)=>String(Number(start.slice(0,4))+i));
  const utilities=utility.utilities.map(u=>{
    const selected=records.filter(r=>r.utility_id===u.utility_id),selectedStations=stations.filter(r=>r.utility_id===u.utility_id);
    const ids=u.rows.map(r=>r.huc12).sort();
    const stationSummaries=selectedStations.map(s=>({...s,...sampleCoverage(selected.filter(r=>r.station_id===s.station_id)),
      years:years.map(year=>({year,...sampleCoverage(selected.filter(r=>r.station_id===s.station_id&&r.year===year))}))}));
    const observedHucs=distinct(selectedStations.map(s=>s.matched_huc12).filter(Boolean));
    if(observedHucs.some(h=>!ids.includes(h)))throw Error("The source station belongs to a different utility HUC selection");
    return {utility_id:u.utility_id,title:u.title,huc12s:ids,anchor_huc12s:u.anchor_huc12s,
      profile_sha256:input.sourceIdentities.profile.sha256,summary:sampleCoverage(selected),
      geographic_basis:u.utility_id==="ARJWS"?"Original WGS84 station points within the selected original WBD HUC12 polygons":"Original WQP HUC8 03060102 and the retained complete 32-HUC union; individual HUC12 assignment remains separate",
      huc12_coverage:u.utility_id==="ARJWS"?{state:"original_station_polygon_membership",with_stations:observedHucs,
        without_selected_stations:ids.filter(h=>!observedHucs.includes(h))}:{state:"publisher_huc8_membership",with_stations:null,without_selected_stations:null},
      years:years.map(year=>({year,...sampleCoverage(selected.filter(r=>r.year===year))})),
      station_summaries:stationSummaries,station_year_method_groups:stationGroups(selected),
      regional_stream_role:"Original stream and gauge observations have separately recorded geography and sampling support",
      model_interpretation:"E. coli is observed microbial concentration in original MPN/100mL units. The selected NDR nitrogen/phosphorus and SDR sediment outputs retain their separate constituents and annual land-origin mass quantities."};
  });
  return {schema:"upstate.utility-observed-context/v1",version:VERSION,
    title:"Original utility observations and regional stream sampling context",edition:"20261013",
    source_identities:copy(input.sourceIdentities),profile_sha256:input.sourceIdentities.profile.sha256,
    microbial_query_period:{start,end},
    utilities,regional_stream:{stations:streamStations,nutrient_groups:nutrients,
      flow_coverage:copy(input.flowCoverage),
      geographic_meaning:"Original stream station points are joined to the exact ARJWS polygons; Pioneer scope uses the source HUC8 and retained full utility union. Gauge network relationships remain original, separate fields.",
      quantity_meaning:"Original nutrient sample concentrations retain constituent, fraction, method and units. USGS daily mean discharge supplies dated regional flow context. Annual NDR/SDR land-origin export and intake concentration use different quantities and support.",
      interpretation:"Use the observed temporal coverage to plan sampling and inspect source components. An annual observed load requires a separately specified, geographically matched concentration/flow integration with uncertainty and transport assumptions."},
    methods:{records:"Every microbial source row remains in the original table. Detection conditions, reporting limits, field replicate and original comments remain separate.",
      summaries:"Station/year/method/activity/unit groups describe retained samples. Numeric-only statistics exclude censored/missing rows and state their measured counts. The explicit Information Only view uses the original ResultCommentText marker.",
      temporal:"Unique sampling dates count once within each displayed group; no campaign mean is presented as a calendar-year mean or annual load.",
      geography:"Native original utility memberships and station evidence are preserved separately from regional analogue observations.",
      model_endpoint:"NDR and SDR produce annual land-origin delivery to the modeled stream. Receiving-water concentration also depends on discharge and subsequent transport/processes.",
      review:"Needs expert review for site-specific sampling design and interpretation."}};
}
export function observedCsv(rows,columns) {
  const value=x=>x===null||x===undefined?"":typeof x==="object"?JSON.stringify(x):String(x);
  const cell=x=>{let s=value(x);if(/^[=+@\t\r]/.test(s)||/^-(?!\d)/.test(s))s="'"+s;return /[",\r\n]/.test(s)?'"'+s.replace(/"/g,'""')+'"':s;};
  return columns.join(",")+"\n"+rows.map(r=>columns.map(k=>cell(r[k])).join(",")).join("\n")+"\n";
}
export function observedOutputs(result) {
  const statuses=["measured","above_limit","below_limit","not_detected","not_reported","missing"];
  const groups=result.utilities.flatMap(u=>u.station_year_method_groups.map(r=>{
    const out={utility_id:u.utility_id,station_id:r.station_id,year:r.year,method_context:r.method_context,
      method:r.method,activity_type:r.activity_type,source_unit:r.source_unit,records:r.records,
      activities:r.activities,unique_dates:r.unique_dates,first_date:r.first_date,last_date:r.last_date,
      sampled_months:r.observed_months,measured_count:r.measured.measured_count,
      measured_minimum:r.measured.minimum,measured_median:r.measured.median,measured_maximum:r.measured.maximum,
      information_only_records:r.information_only_records,records_with_source_comments:r.records_with_source_comments,
      after_excluding_information_only_records:r.excluding_information_only.records,
      after_excluding_information_only_measured_count:r.excluding_information_only.measured.measured_count,
      after_excluding_information_only_measured_median:r.excluding_information_only.measured.median};
    for(const status of statuses)out["status_"+status]=r.detection_status[status]||0;
    return out;
  }));
  const years=result.utilities.flatMap(u=>u.years.map(r=>({utility_id:u.utility_id,...r})));
  const stations=result.utilities.flatMap(u=>u.station_summaries.map(r=>{
    const {years,...out}=r;
    for(const year of years){out["records_"+year.year]=year.records;out["sample_dates_"+year.year]=year.unique_dates;}
    return {utility_id:u.utility_id,...out};
  }));
  const references=result.utilities.flatMap(u=>u.station_year_method_groups.flatMap(g=>g.original_row_references.map(r=>({
    utility_id:u.utility_id,station_id:g.station_id,year:g.year,method_context:g.method_context,
    method:g.method,activity_type:g.activity_type,source_unit:g.source_unit,...r}))));
  const shape=rows=>distinct(rows.flatMap(r=>Object.keys(r)));
  return {"utility-observed-context.json":JSON.stringify(result,null,2)+"\n",
    "utility-station-year-method.csv":observedCsv(groups,shape(groups)),
    "utility-year-coverage.csv":observedCsv(years,shape(years)),
    "utility-station-coverage.csv":observedCsv(stations,shape(stations)),
    "utility-original-record-index.csv":observedCsv(references,shape(references)),
    "regional-stream-geography.csv":observedCsv(result.regional_stream.stations,shape(result.regional_stream.stations)),
    "regional-nutrient-series.csv":observedCsv(result.regional_stream.nutrient_groups,shape(result.regional_stream.nutrient_groups))};
}

export function observedHtml(result) {
  const esc=v=>String(v??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const n=v=>v===null||v===undefined?"":Number.isInteger(v)?String(v):String(Number(Number(v).toPrecision(6)));
  const table=(heads,rows)=>"<table><thead><tr>"+heads.map(h=>"<th>"+esc(h)+"</th>").join("")+"</tr></thead><tbody>"+rows.map(r=>"<tr>"+r.map(c=>"<td>"+esc(c)+"</td>").join("")+"</tr>").join("")+"</tbody></table>";
  let body="<h1>Utility observations and regional stream context</h1><p>Original source edition "+esc(result.edition)+". Utility planning footprints retain their original source profile and whole-watershed memberships.</p>";
  body+='<p><a href="utility-observed-context.json">Complete context JSON</a> · <a href="utility-station-year-method.csv">Station/year/method CSV</a> · <a href="utility-year-coverage.csv">Annual sampling coverage CSV</a> · <a href="regional-stream-geography.csv">Regional station geography CSV</a></p>';
  for(const u of result.utilities){
    const a=u.summary;
    body+="<section><h2>"+esc(u.title)+"</h2><p>"+esc(u.geographic_basis)+".</p>";
    body+=table(["Original records","Stations","Unique dates","First sample","Last sample","Information Only","Field replicate"],[[a.records,a.stations,a.unique_dates,a.first_date,a.last_date,a.information_only_records,a.activity_types["Quality Control Sample-Field Replicate"]||0]]);
    body+="<h3>Original station coverage</h3>"+table(["Station","Publisher HUC8","Original matched HUC12","Records","Dates","First","Last"],u.station_summaries.map(s=>[s.station_id,s.source_huc8,s.matched_huc12,s.records,s.unique_dates,s.first_date,s.last_date]));
    if(u.huc12_coverage.without_selected_stations)body+="<p>Selected utility HUC12s without a station in this retained microbial cohort: "+esc(u.huc12_coverage.without_selected_stations.join(", ")||"none")+".</p>";
    body+="<h3>Sampling by calendar year</h3>"+table(["Year","Active stations","Records","Unique dates","Sampled months","Original detection states"],u.years.map(y=>[y.year,y.stations,y.records,y.unique_dates,y.observed_months.length,JSON.stringify(y.detection_status)]));
    body+="<p>Active station sets change across years. Counts describe original sampling coverage in this selected cohort.</p>";
    body+="<details><summary>Original station/year/method concentration summaries</summary><p>Each row retains its own original unit and activity type. Measured-only medians describe the listed numeric results; original censored counts and source comments remain separate.</p>";
    body+=table(["Station / year","Method / activity","Original unit","Measured / all","Numeric median","Detection states","Information Only","Median after explicit comment filter"],u.station_year_method_groups.map(g=>[g.station_id+" / "+g.year,g.method_context+" "+g.method+" / "+g.activity_type,g.source_unit,g.measured.measured_count+" / "+g.records,n(g.measured.median),JSON.stringify(g.detection_status),g.information_only_records,n(g.excluding_information_only.measured.median)]))+"</details><p>"+esc(u.model_interpretation)+"</p></section>";
  }
  body+="<section><h2>Regional nutrient and flow context</h2><p>"+esc(result.regional_stream.geographic_meaning)+"</p>";
  body+=table(["Station","Original HUC8","ARJWS geometry relation","Pioneer source relation","Original gauge network relation"],result.regional_stream.stations.map(s=>[s.station_id,s.original_huc8,s.arjws_scope,s.prwd_scope,s.gauge_network_relation]));
  const f=result.regional_stream.flow_coverage;
  body+="<p>The existing regional source analysis retains "+esc(f.result_rows)+" nutrient rows on "+esc(f.unique_sampling_dates)+" distinct dates and "+esc(f.gauge_daily_records)+" original daily flow records. Of "+esc(f.extreme_flow_episodes)+" source-defined high-flow episodes, "+esc(f.unsampled_extreme_episodes)+" had no sample date in the four-station cohort.</p>";
  body+=table(["Year","Daily flow records","Sample dates","P95-flow days","Sample dates ≥P95","Water-volume share on ≥P95 days (%)","Provisional days"],f.network_years.map(y=>[y.period,y.daily_records,y.sampled_dates,y.extreme_flow_days,y.extreme_sampled_dates,n(y.extreme_flow_volume_percent),y.provisional_days]));
  body+="<p>"+esc(result.regional_stream.quantity_meaning)+"</p><p>"+esc(result.regional_stream.interpretation)+"</p></section>";
  body+="<section><h2>Original source identities</h2>"+table(["Role","Original retained member","SHA256"],Object.entries(result.source_identities).map(([k,v])=>[k,v.path,v.sha256]));
  body+="<h3>Source references</h3><ul>"+Object.entries(result.source_identities).map(([k,v])=>'<li><a href="'+esc(v.uri)+'">'+esc(k)+'</a></li>').join("")+"</ul><p>"+esc(result.methods.review)+"</p></section>";
  return '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Utility observed context</title><style>body{font:15px/1.5 system-ui,sans-serif;color:#222;background:white;max-width:1250px;margin:30px auto;padding:0 20px}table{border-collapse:collapse;width:100%;font-size:12px;margin:18px 0}th,td{border-bottom:1px solid #bbb;text-align:left;vertical-align:top;padding:8px;overflow-wrap:anywhere}th{background:#eee}a{color:#222}h2{margin-top:36px}details{margin:20px 0}summary{cursor:pointer;font-weight:600}@media print{body{max-width:none;margin:0}thead{display:table-header-group}tr{break-inside:avoid}details{display:block}}</style></head><body>'+body+"</body></html>\n";
}
