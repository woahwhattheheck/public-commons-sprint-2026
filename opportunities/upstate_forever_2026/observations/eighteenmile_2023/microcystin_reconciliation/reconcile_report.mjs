// Render source-preserving reconciliation outputs.
export function renderMicrocystinReconciliation(result, writeCsv) {
  const escape=x=>String(x??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
  const table=(headers,rows)=>"<table><thead><tr>"+headers.map(v=>"<th>"+escape(v)+"</th>").join("")+"</tr></thead><tbody>"+rows.map(row=>"<tr>"+row.map(v=>"<td>"+escape(v)+"</td>").join("")+"</tr>").join("")+"</tbody></table>";
  const num=x=>Number(x).toFixed(6);
  const summary=table(["Station","n","Published mean ± SD","Original records; caption method","Max (source → 3 dp)","Mean comparison"],
    result.summary.map(r=>[r.station,r.n,`${r.published_mean} ± ${r.published_sample_sd}`,`${num(r.caption_fixed_0008_mean)} ± ${num(r.caption_fixed_0008_sample_sd)}`,`${r.original_max} → ${r.original_max_decimal_half_up_3dp}`,r.mean_matches?"Matches at 3 dp":"0.001 µg/L display difference"]));
  const sensitivity=table(["Station","Original values mean / SD","Rounded inputs mean / SD","Half each actual limit mean","Original-limit mean interval"],
    result.summary.map(r=>[r.station,`${r.caption_mean_3dp} / ${r.caption_sample_sd_3dp}`,`${r.rounded_source_mean_3dp} / ${r.rounded_source_sample_sd_3dp}`,num(r.half_each_actual_limit_mean),`[${num(r.original_limit_mean_lower)}, ${num(r.original_limit_mean_upper)})`]));
  const clock=table(["Station","Microcystin date","Chlorophyll date","Original time / zone"],result.date_clock_matches.map(r=>[r.station,r.micro_date,r.chla_date,`${r.original_clock} ${r.original_timezone}`]));
  const exclusions=table(["Station","Date","Time","Reported value / limit","Selection reason"],result.excluded.map(r=>[r.station_id.split("SV-").pop(),r.sample_date,r.sample_time,r.reported_value!==""?r.reported_value:`<${r.detection_limit}`,r.micro_cohort_selection_basis]));
  const links=[["selected-original-records.csv","73 selected source records"],["excluded-original-records.csv","12 excluded source records"],["report-comparison.csv","Complete comparison and sensitivity"],["different-date-clock-matches.csv","Original date and clock pairs"],["published-table8.csv","Published Table 8 transcription"],["report-reconciliation.json","Complete structured analysis"]];
  const html=`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Eighteenmile microcystin report reconciliation</title>
<style>body{font:15px/1.5 system-ui,sans-serif;color:#202020;background:#fff;max-width:1180px;margin:32px auto;padding:0 22px}h1{font-size:27px;line-height:1.2}h2{font-size:20px;margin:32px 0 10px}p{max-width:100ch}table{border-collapse:collapse;width:100%;font-size:13px;margin:16px 0 24px}th,td{border:1px solid #ccc;padding:8px;text-align:left;vertical-align:top}th{background:#f0f0f0;font-weight:600}a{color:inherit;text-decoration:underline}.notice{border-left:3px solid #666;padding:8px 14px;background:#f5f5f5}.meta{font-size:13px;color:#555}code{font-family:ui-monospace,monospace}@media(max-width:760px){.table-wrap{overflow-x:auto}th,td{min-width:90px}}@media print{body{margin:0;max-width:none}h2{break-after:avoid}tr{break-inside:avoid}a{text-decoration:none}}</style></head><body>
<p class="meta">2023 Eighteenmile Creek study · original source reconciliation</p>
<h1>Microcystin summary: a reproducible 73-record selection</h1>
<p>A candidate cohort derived from the original special-station sampling calendar reproduces every published station count, sample standard deviation and rounded maximum, plus four of the five rounded means in Table 8.</p>
<p class="notice">${escape(result.methods.source_selection_status)} Original dates, clocks, reporting limits and measurement values remain in the downloads.</p>
<h2>Selection and source</h2>
<p>${escape(result.methods.scope)} The resulting 73 records comprise 43 results from SV-838, SV-839 and SV-840, plus 30 from SV-268 and SV-374. Two repeated station-dates are selected by the original chlorophyll clock. The full campaign contains 85 records.</p>
<p>Published comparison: <a href="${escape(result.methods.report_url)}">South Carolina DES 2023 Lake Program final report</a>, Table 8, printed page 16 / PDF page 23. ${escape(result.methods.sampling_protocol)}</p>
<h2>Published summary compared with original records</h2>
<p>All concentrations are µg/L. This table applies the report caption's fixed 0.008 replacement to below-limit records solely to compare the reported calculation. Standard deviation uses n−1.</p>
<div class="table-wrap">${summary}</div>
<h2>Reporting limits and precision</h2>
<p>The selected originals contain 17 below-limit records: four with 0.1 µg/L limits and thirteen with 0.016 µg/L limits. The source-informed interval calculation retains each actual limit. It is displayed separately from the report-caption substitution.</p>
<p>At SV-839, the original values yield a mean of 0.050433 µg/L (0.050 at three decimal places). Rounding individual quantified values to 0.001 before aggregation changes the mean to 0.050667 (0.051), but changes the displayed standard deviation to 0.027. This sensitivity explains how precision can affect the last digit; it does not establish the publisher's calculation.</p>
<div class="table-wrap">${sensitivity}</div>
<h2>Original dates with matching clocks</h2>
<p>Four microcystin samples dated August 24 have the same station, displayed clock and time-zone label as chlorophyll samples dated September 5. The dates differ by twelve days. Each original date remains unchanged in this analysis and in the separate strict date/time paired analysis.</p>
<div class="table-wrap">${clock}</div>
<h2>Records outside this candidate selection</h2>
<div class="table-wrap">${exclusions}</div>
<h2>Downloads and reproduction</h2>
<ul>${links.map(([p,label])=>`<li><a href="${escape(p)}">${escape(label)}</a></li>`).join("")}</ul>
<p><code>node observations/eighteenmile_2023/microcystin_reconciliation/build_report_reconciliation.mjs --output /owned/microcystin-report-reconciliation</code></p>
<p class="meta">Every selected and excluded row retains the original activity ID, source-record index, source SHA256, source URL and all normalized original fields. Input hashes are checked before recomputation.</p>
</body></html>
`;
  return {
    "selected-original-records.csv":writeCsv(result.selected),
    "excluded-original-records.csv":writeCsv(result.excluded),
    "report-comparison.csv":writeCsv(result.summary),
    "different-date-clock-matches.csv":writeCsv(result.date_clock_matches),
    "published-table8.csv":writeCsv(result.published_table8),
    "report-reconciliation.json":JSON.stringify(result,null,2)+"\n",
    "report-reconciliation.html":html
  };
}
