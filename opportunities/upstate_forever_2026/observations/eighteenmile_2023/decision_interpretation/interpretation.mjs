export function buildInterpretation({monthlyPH, surfaceRanges, study, selectedChlorophyll, flowDates, inputs, sourceRoot = "../report_context"}) {
  const stations = ["SV-838", "SV-839"];
  const common = stations.map(site_id => {
    const rows = monthlyPH.filter(r => r.site_id === site_id && Number(r.year) === 2023 && Number(r.month) >= 4 && Number(r.month) <= 9).sort((a,b) => Number(a.month)-Number(b.month));
    if (rows.length !== 6 || rows.some((r,i) => Number(r.month) !== i+4)) throw Error("Expected complete April–September original monthly rows for " + site_id);
    const numerator = rows.reduce((n,r) => n+Number(r.days_with_max_above_8_5),0);
    const denominator = rows.reduce((n,r) => n+Number(r.n_days),0);
    if (rows.some(r => !Number.isInteger(Number(r.n_days)) || !Number.isInteger(Number(r.days_with_max_above_8_5)) || Number(r.days_with_max_above_8_5)<0 || Number(r.days_with_max_above_8_5)>Number(r.n_days))) throw Error("Invalid original monthly support");
    const spot = surfaceRanges.find(r => r.site_id === site_id);
    if (!spot) throw Error("Missing original surface range");
    return {site_id, period_start:study.continuous.table_record_start, period_end:"2023-09-30", days_daily_max_above_study_reference:numerator, observed_days:denominator, observed_day_fraction:numerator/denominator, study_reference_ph_su:8.5, original_monthly_rows:rows, original_surface_range:spot};
  });
  if (common[0].observed_days !== common[1].observed_days || common[0].original_monthly_rows.some((r,i) => r.n_days !== common[1].original_monthly_rows[i].n_days)) throw Error("Different monthly day supports");
  const sites = ["SV-268","SV-838","SV-839","SV-374","SV-840"];
  if (selectedChlorophyll.length !== 75 || sites.some(site => selectedChlorophyll.filter(r=>r.station_id==="21SC60WQ_WQX-"+site).length !== 15) || new Set(selectedChlorophyll.map(r=>r.sample_date)).size !== 15) throw Error("Expected the original75-observation/15-visit cohort");
  const october = ["2023-10-03","2023-10-17"].map(date => {
    const records = sites.map(site => {
      const rows = selectedChlorophyll.filter(r => r.sample_date === date && r.station_id === "21SC60WQ_WQX-"+site);
      if (rows.length !== 1) throw Error("Need one retained selected observation per station/date");
      const r = rows[0];
      if (r.reported_unit !== "ug/L" || r.quantitation_class !== "quantified" || !Number.isFinite(Number(r.numeric_reported_value))) throw Error("Unexpected selected CHLA units or quantitation");
      return {site_id:site, value:Number(r.numeric_reported_value), unit:r.reported_unit, original:r};
    });
    const flow = flowDates.filter(r => r.sampling_date === date);
    if (flow.length !== 1) throw Error("Missing original same-date upstream context");
    const allUpper = selectedChlorophyll.filter(r => r.station_id === "21SC60WQ_WQX-SV-838").map(r => Number(r.numeric_reported_value));
    const upper = records.find(r => r.site_id === "SV-838").value;
    return {date, upper_arm_descending_rank_among_15:1+allUpper.filter(v=>v>upper).length, observations:records, upstream_flow_context:flow[0]};
  });
  return {schema:"upstate.eighteenmile-decision-interpretation/v1", inputs, original_study_root:sourceRoot, observed_scope:study.hydrography, comparison_focus_huc12:["030601010703","030601010704","030601020507","030601020502"], common_period_ph:common, october_response_context:october, methods:{ph:"Sum the original Table 6 daily-maximum counts and observed-day denominators across April–September, the common full monthly support. Fractions describe those observed days; they are not percentages of 30-minute readings.",spot_comparison:"Original Table 2 spot ranges remain attached with their April–October period and 0.3 m depth. Continuous records are approximately 0.5 m at 30-minute intervals. The ranges and common-day counts are different observation designs.",chlorophyll:"Use the owner's unchanged75-row selected cohort. Same calendar dates preserve separate clocks, source timezone labels, activity IDs and original rows.",flow:"Retain the existing upstream USGS02186702 daily-mean and prior-seven-calendar-day context without recomputation or assigning discharge to the lake sites.",interpretation:"These descriptive observations inform receiving-water response context and monitoring design. Source-pressure attribution requires the spatial/temporal model and source inventory; annual export scenarios retain their own mass units and support."}};
}

export function supportRows(result) {
  return result.common_period_ph.map(x=>({site_id:x.site_id,continuous_period_start:x.period_start,continuous_period_end:x.period_end,days_daily_max_above_8_5:x.days_daily_max_above_study_reference,observed_days:x.observed_days,observed_day_fraction:x.observed_day_fraction,spot_ph_min_su:x.original_surface_range.ph_min_su,spot_ph_max_su:x.original_surface_range.ph_max_su,spot_period_start:x.original_surface_range.period_start,spot_period_end:x.original_surface_range.period_end,spot_depth_m:x.original_surface_range.depth_m,continuous_approximate_depth_m:0.5,continuous_interval_minutes:30,source_pdf_page:19,source_table:6,source_url:x.original_surface_range.source_url}));
}
