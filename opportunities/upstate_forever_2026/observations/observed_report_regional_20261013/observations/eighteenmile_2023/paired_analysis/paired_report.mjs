// Copyright TokenJunkieLabs. Source-bound report and complete table exports.
export function renderPairedStudy(result, writeCsv) {
  const sourceMap=new Map(result.source_rows.map(r=>[r.record_id,r]));
  const src=ref=>ref?sourceMap.get(ref.record_id):null;
  const esc=value=>String(value??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const num=(n,d=3)=>n===null||n===undefined?"":Number(n).toFixed(d);
  const csvPair=result.chlorophyll_pairs.map(r=>({station_a:r.station_a,station_b:r.station_b,sample_date:r.sample_date,unit:r.unit,
    value_a:r.value_a,value_b:r.value_b,difference_b_minus_a:r.difference_b_minus_a,ratio_b_over_a:r.ratio_b_over_a,
    percent_difference_relative_to_a:r.percent_difference_relative_to_a,recorded_clock_separation_minutes:r.recorded_clock_separation_minutes,
    record_a:r.source_a.record_id,record_b:r.source_b.record_id}));
  const csvSummary=result.chlorophyll_pair_summary.map(r=>({station_a:r.station_a,station_b:r.station_b,unit:r.unit,n:r.paired_dates,
    mean_difference_b_minus_a:r.difference_b_minus_a.mean,median_difference_b_minus_a:r.difference_b_minus_a.median,
    sd_difference_b_minus_a:r.difference_b_minus_a.sample_sd,minimum_difference:r.difference_b_minus_a.minimum,
    maximum_difference:r.difference_b_minus_a.maximum,mean_ratio_b_over_a:r.ratio_b_over_a.mean,
    median_ratio_b_over_a:r.ratio_b_over_a.median,geometric_mean_ratio_b_over_a:r.geometric_mean_ratio_b_over_a,
    b_lower_dates:r.b_lower_dates,b_equal_dates:r.b_equal_dates,b_higher_dates:r.b_higher_dates,
    maximum_clock_separation_minutes:r.clock_separation_minutes.maximum}));
  const csvLinks=result.cross_analyte_links.map(r=>{const c=src(r.chlorophyll),m=src(r.microcystin);return{
    station:r.station,sample_date:r.sample_date,status:r.status,chlorophyll_ug_l:r.chlorophyll_ug_l,
    chlorophyll_record_id:c.record_id,chlorophyll_activity_id:c.activity_id,chlorophyll_time:c.sample_time,
    chlorophyll_timezone:c.sample_timezone,microcystin_record_id:m?.record_id||"",
    microcystin_activity_id:m?.activity_id||"",microcystin_time:m?.sample_time||"",
    microcystin_timezone:m?.sample_timezone||"",microcystin_reported_value:m?.reported_value||"",
    microcystin_reported_unit:m?.reported_unit||"",microcystin_detection_condition:m?.detection_condition||"",
    microcystin_detection_limit:m?.detection_limit||"",microcystin_detection_limit_unit:m?.detection_limit_unit||"",
    microcystin_interval_lower:r.microcystin_interval?.lower??null,
    microcystin_interval_upper:r.microcystin_interval?.upper??null,
    microcystin_interval_upper_open:r.microcystin_interval?.upper_open??null,
    same_date_candidate_count:r.same_date_candidate_count,
    same_date_candidates:r.same_date_candidates.map(x=>({record_id:x.source.record_id,clock:src(x.source).sample_time,
      timezone:src(x.source).sample_timezone,recorded_clock_offset_minutes:x.recorded_clock_offset_minutes,interval:x.interval}))};});
  const csvMicro=result.microcystin_pairs.map(r=>({station_a:r.station_a,station_b:r.station_b,sample_date:r.sample_date,unit:r.unit,
    difference_b_minus_a_lower:r.difference_b_minus_a_lower,difference_b_minus_a_upper:r.difference_b_minus_a_upper,
    lower_open:r.lower_open,upper_open:r.upper_open,identifiable_direction:r.identifiable_direction,
    a_lower:r.a_interval.lower,a_upper:r.a_interval.upper,a_upper_open:r.a_interval.upper_open,
    b_lower:r.b_interval.lower,b_upper:r.b_interval.upper,b_upper_open:r.b_interval.upper_open,
    record_a:r.source_a.record_id,record_b:r.source_b.record_id}));
  const campaign=result.microcystin_campaign.map(r=>{const s=src(r.source);return{station:s.station_id,sample_date:s.sample_date,
    sample_time:s.sample_time,sample_timezone:s.sample_timezone,record_id:s.record_id,activity_id:s.activity_id,
    project_id:s.project_id,reported_value:s.reported_value,reported_unit:s.reported_unit,
    detection_condition:s.detection_condition,detection_limit_type:s.detection_limit_type,
    detection_limit:s.detection_limit,detection_limit_unit:s.detection_limit_unit,
    lower:r.interval.lower,upper:r.interval.upper,upper_open:r.interval.upper_open,unit:r.interval.unit,
    exact_chlorophyll_clock_link:r.exact_chlorophyll_clock_link};});
  const table=(headers,rows)=>'<div class="table-wrap"><table><thead><tr>'+headers.map(x=>"<th>"+esc(x)+"</th>").join("")+
    "</tr></thead><tbody>"+rows.map(row=>"<tr>"+row.map(x=>"<td>"+esc(x)+"</td>").join("")+"</tr>").join("")+"</tbody></table></div>";
  const sourceLink=ref=>{const s=src(ref);return '<a href="'+esc(s.source_url)+'">'+esc(s.station_id.replace("21SC60WQ_WQX-","")+" "+s.sample_date+" "+s.sample_time)+"</a>";};
  const focus=result.chlorophyll_pair_summary.find(x=>x.station_a==="SV-838"&&x.station_b==="SV-840");
  const focusMicro=result.microcystin_pair_summary.find(x=>x.station_a==="SV-838"&&x.station_b==="SV-840");
  const dates=[...new Set(result.cross_analyte_links.map(r=>r.sample_date))].sort();
  const sameDayRows=dates.map(date=>[date,...result.coverage.station_order.map(site=>{
    const r=result.cross_analyte_links.find(x=>x.sample_date===date&&x.station===site);return num(r.chlorophyll_ug_l,2);
  })]);
  const mismatches=result.cross_analyte_links.filter(r=>!r.microcystin).map(r=>[r.station,r.sample_date,src(r.chlorophyll).sample_time,
    r.same_date_candidate_count?r.same_date_candidates.map(x=>src(x.source).sample_time+" ("+x.recorded_clock_offset_minutes+" min)").join("; "):"No original result on this date",
    r.status.replaceAll("_"," ")]);
  const repeated=result.repeated_microcystin_station_dates.map(r=>[r.station,r.sample_date,...[
    r.source_records.map(ref=>{const s=src(ref);return s.sample_time+": "+(s.reported_value||"<"+s.detection_limit)+" "+(s.reported_unit||s.detection_limit_unit);}).join("; ")]]);
  const files={
    "paired-observations.json":JSON.stringify(result)+"\n",
    "chlorophyll-station-summary.csv":writeCsv(result.chlorophyll_station_summary),
    "chlorophyll-pair-summary.csv":writeCsv(csvSummary),
    "chlorophyll-pairs.csv":writeCsv(csvPair),
    "cross-analyte-links.csv":writeCsv(csvLinks),
    "microcystin-pair-summary.csv":writeCsv(result.microcystin_pair_summary),
    "microcystin-pairs.csv":writeCsv(csvMicro),
    "microcystin-campaign-support.csv":writeCsv(campaign),
    "source-records.csv":writeCsv(result.source_rows),
    "methods.json":JSON.stringify({schema:result.schema,methods:result.methods,coverage:result.coverage},null,2)+"\n"
  };
  const downloads=Object.keys(files).map(name=>'<a href="'+name+'">'+esc(name)+'</a>').join(" &middot; ");
  const intervals=result.microcystin_pair_summary.map(r=>[r.station_a,r.station_b,r.paired_dates,
    r.b_lower_dates,r.b_higher_dates,r.equal_quantified_dates,r.unresolved_dates,
    (r.mean_lower_open?"(":"[")+num(r.mean_difference_lower,6)+", "+num(r.mean_difference_upper,6)+(r.mean_upper_open?")":"]")]);
  const html='<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'+
    '<title>Eighteenmile 2023 paired observations</title><style>'+
    ':root{color-scheme:light;font-family:Arial,Helvetica,sans-serif;color:#202020;background:#f4f4f4}body{margin:0;font-size:15px;line-height:1.55}main{max-width:1120px;margin:auto;padding:34px 30px;background:#fff}h1{font-size:30px;line-height:1.2;margin:8px 0 16px}h2{font-size:21px;margin:32px 0 10px;border-top:1px solid #b9b9b9;padding-top:20px}h3{font-size:17px;margin:22px 0 8px}p{max-width:96ch}.eyebrow{font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:#555}.lead{font-size:18px}a{color:inherit;text-decoration:underline;text-underline-offset:2px}.table-wrap{overflow-x:auto}table{border-collapse:collapse;width:100%;font-variant-numeric:tabular-nums;font-size:13px}th,td{text-align:left;border-bottom:1px solid #d5d5d5;padding:8px;vertical-align:top}th{background:#ededed;font-weight:600}tr:nth-child(even) td{background:#fafafa}.note{padding:14px 18px;border-left:3px solid #555;background:#f5f5f5}.downloads{line-height:2;overflow-wrap:anywhere}code{font-size:12px;overflow-wrap:anywhere}.method{margin:10px 0}.source-list{font-size:12px;overflow-wrap:anywhere}summary{cursor:pointer;font-weight:600;padding:10px 0}@media(max-width:650px){main{padding:22px 14px}h1{font-size:26px}}@media print{body{background:#fff}main{max-width:none;padding:0}h2{break-after:avoid}tr{break-inside:avoid}.table-wrap{overflow:visible}a{color:#000}.downloads{font-size:11px}}'+
    '</style></head><body><main><div class="eyebrow">Upper Savannah · Original 2023 observations</div>'+
    '<h1>Eighteenmile Creek: paired observations</h1><p class="lead">Five sites, 15 shared chlorophyll dates and explicit microcystin reporting limits.</p>'+
    '<p>This comparison follows the original study cohort and preserves every supporting agency activity, recorded clock and source row. It contains '+result.coverage.chlorophyll_spatial_pairs+' same-date chlorophyll contrasts and '+result.coverage.microcystin_spatial_pairs+' microcystin contrasts linked to the selected chlorophyll observations.</p>'+
    '<div class="note"><strong>Reading the observed pattern.</strong> SV-840, the Lake Hartwell station off the Eighteenmile arm, had lower chlorophyll than upper-lake-arm SV-838 on all '+focus.paired_dates+
    ' sampled dates. The mean paired difference (SV-840 minus SV-838) was '+num(focus.difference_b_minus_a.mean)+' ug/L. Their recorded sampling times were '+num(focus.clock_separation_minutes.minimum,0)+'–'+num(focus.clock_separation_minutes.maximum,0)+
    ' minutes apart. The linked microcystin pattern differed: SV-840 was higher on '+focusMicro.b_higher_dates+' dates, lower on '+focusMicro.b_lower_dates+' and unresolved by reporting limits on '+focusMicro.unresolved_dates+
    ' date. These comparisons describe measured concentrations across sites and sampled dates.</div>'+
    '<h2>1. Chlorophyll at the five study sites</h2><p>All selected values are quantified total chlorophyll a corrected for pheophytin, reported in ug/L. The existing study reconciliation selects 15 observations per site; the publisher’s printed Table 7 counts remain in the original study record.</p>'+
    table(["Site","Observations","Mean ug/L","Median ug/L","Sample SD","Minimum","Maximum"],result.chlorophyll_station_summary.map(r=>[r.station,r.n,num(r.mean),num(r.median),num(r.sample_sd),num(r.minimum,2),num(r.maximum,2)]))+
    '<h3>Complete same-date concentration matrix</h3>'+table(["Original date",...result.coverage.station_order],sameDayRows)+
    '<h3>All ten site contrasts</h3><p>Every contrast has the same 15 original dates. Difference is B minus A. Ratios summarize the paired dates individually; their arithmetic mean differs from a ratio of seasonal means.</p>'+
    table(["A","B","Dates","Mean B−A ug/L","Median B−A","B lower","B higher","Median B/A","Maximum clock gap (min)"],result.chlorophyll_pair_summary.map(r=>[r.station_a,r.station_b,r.paired_dates,num(r.difference_b_minus_a.mean),num(r.difference_b_minus_a.median),r.b_lower_dates,r.b_higher_dates,num(r.ratio_b_over_a.median),num(r.clock_separation_minutes.maximum,0)]))+
    '<h2>2. Which microcystin samples can be linked?</h2><p>The full agency campaign contains '+result.coverage.microcystin_campaign_rows+' results across '+result.coverage.microcystin_campaign_dates+' dates. Exactly '+result.coverage.exact_clock_links+
    ' selected chlorophyll samples share station, original date, displayed clock and timezone with a microcystin result. Two have a microcystin result on the same date at a different recorded clock, and six have no same-date microcystin result. The full campaign remains available separately.</p>'+
    table(["Site","Chlorophyll date","Chlorophyll clock","Same-date microcystin candidate","Join outcome"],mismatches)+
    '<h3>Dates with two microcystin activities at one site</h3>'+table(["Site","Date","Original recorded clocks and results"],repeated)+
    '<p>Both repeated activities remain in the source. Exact recorded-clock matching selects the linked study activity; no averaging or nearest-time replacement is applied.</p>'+
    '<h2>3. Microcystin spatial comparisons with reporting limits</h2><p>The campaign has 64 quantified results and 21 below-reporting-limit results. Four censored results use 0.1 ug/L; 17 use 0.016 ug/L. A censored result retains the interval [0, its original limit). The source reported-value field stays blank. Each paired difference propagates both intervals.</p>'+
    '<p>Parentheses mean an excluded endpoint. The mean-difference intervals below are arithmetic bounds for these sampled values. They are not confidence intervals or fitted seasonal estimates. The native observation-support module supplies the separate full-campaign station summaries.</p>'+
    table(["A","B","Linked dates","B lower","B higher","Equal","Unresolved","Mean B−A bounds (ug/L)"],intervals)+
    '<h2>4. Source and method</h2>'+
    Object.entries(result.methods).map(([k,v])=>'<p class="method"><strong>'+esc(k.replaceAll("_"," "))+':</strong> '+esc(v)+'</p>').join("")+
    '<p>Original agency report: <a href="https://des.sc.gov/sites/des/files/Documents/BOW/WaterQuality/2023LakeProgramFinalReport.pdf">SCDES 2023 Lake Program final report</a>. Complete original response collection: <a href="https://app.notion.com/p/3f7dd77231008124b767e1dccf8a706e">Upper Savannah primary sources</a>.</p>'+
    '<details><summary>Original response identities</summary><div class="source-list">'+
    [...new Map(result.source_rows.map(r=>[r.source_path,r])).values()].map(r=>'<p><a href="'+esc(r.source_url)+'">'+esc(r.source_path)+'</a><br>SHA256 <code>'+esc(r.source_sha256)+'</code></p>').join("")+
    '</div></details><h2>Complete downloadable tables</h2><p class="downloads">'+downloads+'</p>'+
    '<p>Join any record_id in the comparison tables to source-records.csv for its original agency activity, recorded date/time, analytical method, reporting limit, row number, query URL and source hash. Full JSON preserves every candidate and interval endpoint.</p>'+
    '</main></body></html>\n';
  files["paired-observations-report.html"]=html;
  return files;
}
