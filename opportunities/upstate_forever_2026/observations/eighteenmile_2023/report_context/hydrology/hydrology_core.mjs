function parseRdb(text){const lines=text.split(/\r?\n/).filter(x=>x&&!x.startsWith("#"));const cols=lines[0].split("\t");return{columns:cols,rows:lines.slice(2).map(l=>Object.fromEntries(l.split("\t").map((v,i)=>[cols[i],v])))}}

function parseCsv(text){const rows=[];let row=[],value="",quoted=false;for(let i=0;i<text.length;i++){const c=text[i];if(quoted){if(c==='"'&&text[i+1]==='"'){value+='"';i++}else if(c==='"')quoted=false;else value+=c}else if(c==='"')quoted=true;else if(c===","){row.push(value);value=""}else if(c==="\n"||c==="\r"){if(c==="\r"&&text[i+1]==="\n")i++;row.push(value);if(row.some(x=>x!==""))rows.push(row);row=[];value=""}else value+=c}if(quoted)throw Error("CSV quotation is incomplete");if(row.length||value){row.push(value);rows.push(row)}const columns=(rows.shift()||[]).map((x,i)=>i===0?x.replace(/^\uFEFF/,""):x);for(const r of rows)if(r.length!==columns.length)throw Error("CSV source row width differs: "+r.length+"/"+columns.length);return{columns,rows:rows.map(r=>Object.fromEntries(columns.map((c,i)=>[c,r[i]]))) }}

export function flowBuild(input) {
  const DAY = 86400000, CFS_TO_CMS = 0.028316846592, SQMI_TO_M2 = 2589988.110336;
  const original = input.originals;
  const find = role => original.filter(x => x.role === role);
  const periodDays = (start, end) => Math.round((Date.parse(end + "T00:00:00Z") - Date.parse(start + "T00:00:00Z")) / DAY) + 1;
  const out = [];
  const csv = (name, rows, columns) => {
    const cols = columns || Object.keys(rows[0] || {});
    const cell = v => {
      const s = v === null || v === undefined ? "" : String(v);
      return /[",\r\n]/.test(s) ? '"' + s.replaceAll('"', '""') + '"' : s;
    };
    out.push({path: name, text: [cols.map(cell).join(","), ...rows.map(row => cols.map(c => cell(row[c])).join(","))].join("\n") + "\n"});
  };
  const json = (name, value) => out.push({path: name, text: JSON.stringify(value, null, 2).replace(/[\u007f-\uffff]/g, c => "\\u" + c.charCodeAt(0).toString(16).padStart(4, "0")) + "\n"});
  const parsedSites = find("station_inventory").map(source => ({source, parsed: parseRdb(source.text)}));
  const sites = parsedSites.flatMap(({source, parsed}) => parsed.rows.map(row => ({...row, original_inventory_source: source.id})));
  if (new Set(sites.map(s => s.site_no)).size !== sites.length) throw new Error("Original station inventories overlap");
  const metadata = Object.fromEntries(sites.map(s => [s.site_no, s]));
  const selected = input.selected_series;
  const selectedBySite = Object.fromEntries(selected.map(s => [s.site_no, s]));
  if (Object.keys(selectedBySite).length !== selected.length) throw new Error("Select one original daily-mean series per site");
  const daily = [], stage = [], qualifiers = {}, seriesMetadata = [], rowKeys = new Set();
  for (const source of [...find("daily_flow"), ...find("daily_stage")]) {
    const response = JSON.parse(source.text.replace(/^\uFEFF/, ""));
    for (const series of response.value.timeSeries) {
      const site = series.sourceInfo.siteCode[0].value;
      const parameter = series.variable.variableCode[0].value;
      const statistic = series.variable.options.option.find(x => x.name === "Statistic").optionCode;
      if (statistic !== "00003") throw new Error("Original input is not a daily mean");
      if (parameter !== (source.role === "daily_flow" ? "00060" : "00065")) throw new Error("Original measured parameter differs");
      const unit = series.variable.unit.unitCode;
      if (unit !== (source.role === "daily_flow" ? "ft3/s" : "ft")) throw new Error("Original measured unit differs");
      for (const [valuesIndex, values] of series.values.entries()) {
        const methodIDs = values.method.map(x => String(x.methodID));
        if (methodIDs.length !== 1) throw new Error("Retain one source method identity per values block");
        const method = methodIDs[0];
        if (source.role === "daily_flow" && method !== String(selectedBySite[site]?.ts_id)) throw new Error("Original daily method differs from the selected catalog series");
        for (const q of values.qualifier || []) qualifiers[q.qualifierCode] = q.qualifierDescription;
        seriesMetadata.push({source_id: source.id, role: source.role, site, parameter, statistic, unit,
          method_id: method, value_count: values.value.length, source_info: series.sourceInfo,
          variable: series.variable, methods: values.method, qualifier_definitions: values.qualifier});
        for (const [recordIndex, record] of values.value.entries()) {
          const date = record.dateTime.slice(0, 10);
          if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date + "T00:00:00Z"))) throw new Error("Original daily date is invalid");
          const n = Number(record.value);
          const valid = record.value !== "" && Number.isFinite(n) && n !== series.variable.noDataValue;
          if (valid && n < 0 && parameter === "00060") throw new Error("Resolve the original negative inland discharge before aggregating");
          const key = [site, parameter, statistic, method, date].join("|");
          if (rowKeys.has(key)) throw new Error("Original daily responses overlap at " + key);
          rowKeys.add(key);
          const row = {site, date, reported_value: record.value, value: valid ? n : null,
            qualifiers: record.qualifiers.join("|"), method_id: method, source_id: source.id,
            source_values_index: valuesIndex, source_record_index: recordIndex, original_datetime: record.dateTime, valid};
          (source.role === "daily_flow" ? daily : stage).push(row);
        }
      }
    }
  }
  daily.sort((a, b) => a.site.localeCompare(b.site) || a.date.localeCompare(b.date));
  stage.sort((a, b) => a.site.localeCompare(b.site) || a.date.localeCompare(b.date));
  const bySite = {};
  for (const row of daily) (bySite[row.site] ||= []).push(row);
  const percentile = (ordered, p) => {
    if (!ordered.length) return null;
    const index = (ordered.length - 1) * p, lo = Math.floor(index), hi = Math.ceil(index);
    return ordered[lo] + (ordered[hi] - ordered[lo]) * (index - lo);
  };
  const exactDecimalSum = rows => {
    let places = 0;
    for (const row of rows) {
      if (!/^-?\d+(\.\d+)?$/.test(row.reported_value)) throw new Error("Use the original decimal representation for discharge sums");
      places = Math.max(places, (row.reported_value.split(".")[1] || "").length);
    }
    const scale = 10 ** places;
    let integer = 0;
    for (const row of rows) {
      const parts = row.reported_value.split(".");
      integer += Number(parts[0] + (parts[1] || "").padEnd(places, "0"));
      if (!Number.isSafeInteger(integer)) throw new Error("Use a larger exact integer accumulator");
    }
    return integer / scale;
  };
  const summarize = (site, start, end, type) => {
    const all = (bySite[site] || []).filter(r => r.date >= start && r.date <= end);
    const valid = all.filter(r => r.valid);
    const values = valid.map(r => r.value).sort((a, b) => a - b);
    const n = valid.length, days = periodDays(start, end), sum = exactDecimalSum(valid);
    const area = Number(metadata[site].drain_area_va) || null;
    const flags = code => valid.filter(r => r.qualifiers.split("|").includes(code)).length;
    const volume = n ? sum * CFS_TO_CMS * 86400 : null;
    const runoff = n && area ? volume / (area * SQMI_TO_M2) * 1000 : null;
    const min = n ? values[0] : null, max = n ? values.at(-1) : null;
    return {site, site_name: metadata[site].station_nm, period_type: type, period_start: start, period_end: end,
      parameter_code: "00060", statistic_code: "00003", method_id: String(selectedBySite[site].ts_id),
      record_days: all.length, valid_days: n, expected_days: days, coverage_fraction: n / days, missing_days: days - n,
      approved_days: flags("A"), provisional_days: flags("P"), estimated_days: flags("e"), revised_days: flags("R"),
      first_observed_date: n ? valid[0].date : null, last_observed_date: n ? valid.at(-1).date : null,
      mean_cfs: n ? sum / n : null, p05_daily_cfs: percentile(values, .05), p50_daily_cfs: percentile(values, .5), p95_daily_cfs: percentile(values, .95),
      minimum_daily_cfs: min, minimum_daily_dates: valid.filter(r => r.value === min).map(r => r.date).join("|"),
      maximum_daily_cfs: max, maximum_daily_dates: valid.filter(r => r.value === max).map(r => r.date).join("|"),
      observed_volume_m3: volume, complete_period_volume_m3: n === days ? volume : null,
      source_drainage_area_sqmi: area, observed_runoff_mm: runoff, complete_period_runoff_mm: n === days ? runoff : null};
  };
  const annual = [], monthly = [], study = [];
  for (const selectedSite of selected) {
    const site = selectedSite.site_no;
    for (let year = input.first_year; year <= input.last_year; year++) {
      annual.push(summarize(site, year + "-01-01", year + "-12-31", "calendar_year"));
      for (let month = 1; month <= 12; month++) {
        const mm = String(month).padStart(2, "0"), last = new Date(Date.UTC(year, month, 0)).getUTCDate();
        monthly.push(summarize(site, `${year}-${mm}-01`, `${year}-${mm}-${last}`, "calendar_month"));
      }
    }
    study.push(summarize(site, input.study_start, input.study_end, "lake_study_window"));
  }
  csv("daily_flow.csv", daily.map(r => ({site: r.site, date: r.date, reported_mean_cfs: r.reported_value,
    qualifiers: r.qualifiers, method_id: r.method_id, source_id: r.source_id, source_values_index: r.source_values_index, source_record_index: r.source_record_index})));
  csv("calendar_year_flow.csv", annual);
  csv("calendar_month_flow.csv", monthly);
  csv("study_period_flow.csv", study);
  csv("daily_stage.csv", stage.map(r => ({site: r.site, date: r.date, reported_mean_stage_feet: r.reported_value,
    qualifiers: r.qualifiers, method_id: r.method_id, source_id: r.source_id, source_values_index: r.source_values_index, source_record_index: r.source_record_index})));
  const stageAnnual = [];
  for (const site of [...new Set(stage.map(r => r.site))]) for (let year = input.first_year; year <= input.last_year; year++) {
    const start = year + "-01-01", end = year + "-12-31";
    const all = stage.filter(r => r.site === site && r.date >= start && r.date <= end);
    if (!all.length) continue;
    const valid = all.filter(r => r.valid), numbers = valid.map(r => r.value).sort((a, b) => a - b);
    stageAnnual.push({site, site_name: metadata[site].station_nm, year, parameter_code: "00065", statistic_code: "00003",
      unit: "ft", observed_days: valid.length, expected_days: periodDays(start, end),
      first_observed_date: valid[0]?.date || null, last_observed_date: valid.at(-1)?.date || null,
      mean_stage_feet: valid.length ? exactDecimalSum(valid) / valid.length : null,
      minimum_stage_feet: numbers[0] ?? null, median_stage_feet: percentile(numbers, .5), maximum_stage_feet: numbers.at(-1) ?? null,
      approved_days: valid.filter(r => r.qualifiers.split("|").includes("A")).length,
      provisional_days: valid.filter(r => r.qualifiers.split("|").includes("P")).length});
  }
  csv("calendar_year_stage.csv", stageAnnual);
  const features = sites.map(site => {
    if (site.dec_coord_datum_cd !== "NAD83") throw new Error("Keep the original station coordinate datum in a separate native layer");
    const source = original.find(s => s.id === site.original_inventory_source);
    const values2023 = annual.find(r => r.site === site.site_no && r.period_start === "2023-01-01");
    const p = {...site, source_crs: "EPSG:4269", source_uri: source.uri,
      monitoring_location_id: site.agency_cd + "-" + site.site_no,
      monitoring_location_uri: "https://waterdata.usgs.gov/monitoring-location/" + site.agency_cd + "-" + site.site_no + "/",
      observed_flow_series: Number(Boolean(selectedBySite[site.site_no])),
      original_source_drainage_area_sqmi: site.drain_area_va === "" ? null : Number(site.drain_area_va),
      flow_method_id: selectedBySite[site.site_no]?.ts_id || "",
      observed_flow_days_2020_2025: (bySite[site.site_no] || []).filter(r => r.valid).length,
      flow_days_2023: values2023?.valid_days ?? null, mean_flow_cfs_2023: values2023?.mean_cfs ?? null,
      complete_volume_m3_2023: values2023?.complete_period_volume_m3 ?? null,
      complete_runoff_mm_2023: values2023?.complete_period_runoff_mm ?? null,
      observed_stage_days_2023_2025: stage.filter(r => r.site === site.site_no && r.valid).length};
    return {type: "Feature", id: p.monitoring_location_id, geometry: {type: "Point", coordinates: [Number(site.dec_long_va), Number(site.dec_lat_va)]}, properties: p};
  });
  json("monitoring_stations_nad83.geojson", {type: "FeatureCollection", crs: {type: "name", properties: {name: "EPSG:4269"}}, features});
  const basin = find("gage_basin")[0], reference = find("gage_network_reference")[0];
  if (basin && reference) {
    const geometry = JSON.parse(basin.text), location = JSON.parse(reference.text).features[0].properties;
    json("eighteenmile_gage_whole_catchments.geojson", {type: "FeatureCollection", crs: {type: "name", properties: {name: "EPSG:4326"}},
      features: geometry.features.map((feature, index) => ({...feature, id: "USGS-02186702-whole-catchments-" + index,
        properties: {...feature.properties, gauge_id: "USGS-02186702", gauge_name: metadata["02186702"].station_nm,
          source_uri: basin.uri, source_response_id: basin.id, source_feature_index: index,
          source_geometry: "Full-resolution NHDPlusV2 upstream whole catchments", simplified: 0, split_catchment: 0,
          nldi_comid: location.comid, nldi_reachcode: location.reachcode, nldi_measure: location.measure,
          source_gauge_drainage_area_sqmi: Number(metadata["02186702"].drain_area_va)}}))});
  }
  const nutrientRows = [], nutrientCoverage = [], activities = new Map();
  const flowByDate = Object.fromEntries((bySite["02186702"] || []).map(r => [r.date, r]));
  const concentration = row => {
    const unit = row["ResultMeasure/MeasureUnitCode"], raw = row.ResultMeasureValue;
    const numeric = raw !== "" && Number.isFinite(Number(raw)) && unit === "mg/L" ? Number(raw) : null;
    const limitRaw = row["DetectionQuantitationLimitMeasure/MeasureValue"], limitUnit = row["DetectionQuantitationLimitMeasure/MeasureUnitCode"];
    const limit = limitRaw !== "" && Number.isFinite(Number(limitRaw)) && limitUnit === "mg/L" ? Number(limitRaw) : null;
    const censored = row.ResultDetectionConditionText === "Present Below Quantification Limit";
    return {numeric, limit, censored, lower: numeric ?? (censored && limit !== null ? 0 : null),
      upper: numeric ?? (censored && limit !== null ? limit : null),
      half: numeric ?? (censored && limit !== null ? limit / 2 : null)};
  };
  for (const source of find("nutrient_results")) {
    const parsed = parseCsv(source.text), dates = [...new Set(parsed.rows.map(r => r.ActivityStartDate))].sort();
    nutrientCoverage.push({source_id: source.id, monitoring_location_id: source.monitoring_location_id, source_uri: source.uri,
      query_start: "2023-01-01", query_end: "2023-12-31", result_rows: parsed.rows.length,
      activities: new Set(parsed.rows.map(r => r.ActivityIdentifier)).size, first_date: dates[0] || "", last_date: dates.at(-1) || "",
      project_ids: [...new Set(parsed.rows.map(r => r.ProjectIdentifier))].sort().join("|")});
    for (const [index, row] of parsed.rows.entries()) {
      const flow = flowByDate[row.ActivityStartDate], c = concentration(row);
      const normalized = {monitoring_location_id: row.MonitoringLocationIdentifier, activity_id: row.ActivityIdentifier,
        project_id: row.ProjectIdentifier, activity_type: row.ActivityTypeCode, sample_date: row.ActivityStartDate,
        source_sample_time: row["ActivityStartTime/Time"], source_time_zone: row["ActivityStartTime/TimeZoneCode"],
        characteristic: row.CharacteristicName, sample_fraction: row.ResultSampleFractionText,
        reported_concentration: row.ResultMeasureValue, reported_unit: row["ResultMeasure/MeasureUnitCode"],
        detection_condition: row.ResultDetectionConditionText, result_status: row.ResultStatusIdentifier,
        limit_type: row.DetectionQuantitationLimitTypeName, reported_limit: row["DetectionQuantitationLimitMeasure/MeasureValue"],
        reported_limit_unit: row["DetectionQuantitationLimitMeasure/MeasureUnitCode"],
        quantified_mg_l: c.numeric, censor_lower_mg_l: c.lower, censor_upper_mg_l: c.upper, half_limit_context_mg_l: c.half,
        laboratory_method: row["ResultAnalyticalMethod/MethodIdentifier"], laboratory_method_context: row["ResultAnalyticalMethod/MethodIdentifierContext"],
        flow_gauge_id: "USGS-02186702", same_date_mean_cfs: flow?.value ?? null, flow_qualifiers: flow?.qualifiers || "",
        flow_source_id: flow?.source_id || "", flow_source_record_index: flow?.source_record_index ?? null,
        calendar_join: "Same reporting date at upstream gauge; original sampling location retained",
        source_id: source.id, source_record_index: index};
      nutrientRows.push(normalized);
      const key = [row.MonitoringLocationIdentifier, row.ActivityIdentifier, row.ProjectIdentifier].join("|");
      if (!activities.has(key)) activities.set(key, []);
      activities.get(key).push({original: row, normalized, concentration: c});
    }
  }
  csv("nutrient_results_with_flow.csv", nutrientRows);
  csv("nutrient_source_coverage.csv", nutrientCoverage);
  const nitrogen = [];
  for (const group of activities.values()) {
    const tkn = group.filter(r => r.original.CharacteristicName === "Kjeldahl nitrogen" && r.original.ResultSampleFractionText === "Unfiltered");
    const nox = group.filter(r => r.original.CharacteristicName === "Nitrate + Nitrite" && r.original.ResultSampleFractionText === "Unfiltered");
    if (tkn.length !== 1 || nox.length !== 1) continue;
    const a = tkn[0], b = nox[0], n = a.normalized;
    const add = name => a.concentration[name] === null || b.concentration[name] === null ? null : a.concentration[name] + b.concentration[name];
    nitrogen.push({monitoring_location_id: n.monitoring_location_id, activity_id: n.activity_id, project_id: n.project_id, sample_date: n.sample_date,
      sample_fraction: "Unfiltered", method: "Total nitrogen = Kjeldahl nitrogen + nitrate/nitrite",
      quantified_tn_mg_l: add("numeric"), tn_censor_lower_mg_l: add("lower"), tn_censor_upper_mg_l: add("upper"), tn_half_limit_context_mg_l: add("half"),
      tkn_source_id: a.normalized.source_id, tkn_source_record_index: a.normalized.source_record_index,
      nox_source_id: b.normalized.source_id, nox_source_record_index: b.normalized.source_record_index,
      flow_gauge_id: n.flow_gauge_id, same_date_mean_cfs: n.same_date_mean_cfs, flow_qualifiers: n.flow_qualifiers,
      flow_source_id: n.flow_source_id, flow_source_record_index: n.flow_source_record_index});
  }
  csv("nutrient_activity_total_nitrogen.csv", nitrogen);
  const nutrientGroups = new Map();
  for (const row of nutrientRows) {
    const key = [row.monitoring_location_id, row.project_id, row.characteristic, row.sample_fraction].join("|");
    if (!nutrientGroups.has(key)) nutrientGroups.set(key, []);
    nutrientGroups.get(key).push(row);
  }
  const means = [];
  for (const group of nutrientGroups.values()) {
    const first = group[0], numeric = group.filter(r => r.quantified_mg_l !== null);
    const halves = group.filter(r => r.half_limit_context_mg_l !== null);
    means.push({monitoring_location_id: first.monitoring_location_id, project_id: first.project_id, characteristic: first.characteristic,
      sample_fraction: first.sample_fraction, result_rows: group.length, activities: new Set(group.map(r => r.activity_id)).size,
      quantified_rows: numeric.length, censored_rows: group.filter(r => r.detection_condition === "Present Below Quantification Limit").length,
      mean_of_quantified_mg_l: numeric.length ? numeric.reduce((s, r) => s + r.quantified_mg_l, 0) / numeric.length : null,
      half_limit_context_mean_mg_l: halves.length ? halves.reduce((s, r) => s + r.half_limit_context_mg_l, 0) / halves.length : null,
      half_limit_context_rows: halves.length, first_date: group.map(r => r.sample_date).sort()[0], last_date: group.map(r => r.sample_date).sort().at(-1)});
  }
  csv("nutrient_concentration_summary.csv", means);
  const coverage = {schema: "upstate.observed-hydrology/v1", captured_at: input.captured_at,
    calendar_start: input.first_year + "-01-01", calendar_end: input.last_year + "-12-31",
    original_source_files: original.length, original_daily_flow_responses: find("daily_flow").length,
    daily_flow_records: daily.length, flow_gauges: selected.length, original_station_inventory_points: sites.length,
    complete_calendar_years: annual.filter(r => r.valid_days === r.expected_days).length, calendar_year_rows: annual.length,
    calendar_month_rows: monthly.length, lake_study_period: {start: input.study_start, end: input.study_end, days: periodDays(input.study_start, input.study_end)},
    study_period_rows: study.length, stage_records: stage.length, stage_gauges: new Set(stage.map(r => r.site)).size,
    nutrient_result_rows: nutrientRows.length, nutrient_activities: activities.size, derived_tn_activities: nitrogen.length,
    nutrient_project_ids: [...new Set(nutrientRows.map(r => r.project_id))], original_qualifier_definitions: qualifiers,
    numerical_method: {discharge_unit: "ft3/s", statistic: "00003 daily mean", decimal_sums: "Original decimal values summed with exact safe integers before division",
      cfs_to_m3s: CFS_TO_CMS, nominal_reporting_day_seconds: 86400, square_miles_to_m2: SQMI_TO_M2,
      percentiles: "Linear interpolation at (n-1)*p on ascending daily values; percentile05 is the low-flow fifth percentile",
      full_period_totals: "Calculated only when every expected calendar date has a valid original daily mean",
      qualified_values: "Original approved, provisional, estimated and revised records are retained with their agency flags",
      stage: "Stage observations retain feet and their own original gage reference",
      nutrient_flow_join: "Identical calendar reporting date at the upstream Eighteenmile gauge; original sample station and project retained",
      nutrient_censor_context: "Quantified concentrations retain their values; below-quantification rows retain 0-to-limit bounds and an explicit half-limit context value",
      nitrogen: "Unfiltered Kjeldahl nitrogen plus unfiltered nitrate/nitrite within the same original activity"}};
  json("coverage.json", coverage);
  json("original_series_metadata.json", seriesMetadata);
  return {files: out, coverage, annual, monthly, study, stageAnnual, nutrientRows, nitrogen, nutrientMeans: means};
}
