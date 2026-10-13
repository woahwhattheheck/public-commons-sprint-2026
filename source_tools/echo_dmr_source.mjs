/** EPA ECHO source preparation. Original responses are authoritative; this module only flattens and annotates them. */
const TARGET_PARAMETERS = {
  "00530": { family: "TSS", basis: "total suspended solids" },
  "00600": { family: "TN", basis: "as N; reported total nitrogen" },
  "00610": { family: "ammonia_N", basis: "as N" },
  "00620": { family: "nitrate_N", basis: "as N" },
  "00625": { family: "TKN", basis: "as N" },
  "00630": { family: "nitrate_nitrite_N", basis: "as N" },
  "00665": { family: "TP", basis: "as P; reported total phosphorus" },
  "50050": { family: "flow", basis: "reported discharge flow" }
};
function numeric(raw) {
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : null;
  if (typeof raw !== "string") return null;
  const s = raw.trim();
  if (!/^[+-]?(?:(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(s)) return null;
  const n = Number(s.replace(/,/g, ""));
  return Number.isFinite(n) ? n : null;
}
function isoDate(raw) {
  if (typeof raw !== "string") return null;
  let y, m, d, q = raw.match(/^(\d{2})-(JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)-(\d{2}|\d{4})$/);
  if (q) { d = +q[1]; m = "JAN FEB MAR APR MAY JUN JUL AUG SEP OCT NOV DEC".split(" ").indexOf(q[2]) + 1; y = q[3].length === 2 ? 2000 + +q[3] : +q[3]; }
  else { q = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})$/); if (!q) return null; m = +q[1]; d = +q[2]; y = +q[3]; }
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() + 1 === m && dt.getUTCDate() === d ? dt.toISOString().slice(0, 10) : null;
}
function periodStart(end, months) {
  const iso = isoDate(end), n = numeric(months);
  if (!iso || !Number.isInteger(n) || n <= 0 || n > 120) return null;
  const [y, m, d] = iso.split("-").map(Number);
  if (d !== new Date(Date.UTC(y, m, 0)).getUTCDate()) return null;
  return new Date(Date.UTC(y, m - n, 1)).toISOString().slice(0, 10);
}
function originalScalarFields(value, omit = []) {
  return Object.fromEntries(Object.entries(value).filter(([k]) => !omit.includes(k)).map(([k, v]) => [k, v && typeof v === "object" ? JSON.stringify(v) : v]));
}
function origin(capture, pointer) {
  return { source_response_id: capture.id, source_json_pointer: pointer, source_uri: capture.uri || capture.url };
}
const NON_MASS_PARAMETERS = {
  "74055": { family: "fecal_coliform", basis: "bacterial indicator; original parameter description" },
  "01290": { family: "color", basis: "ADMI color units; original parameter description" }
};
function selected(code) { return TARGET_PARAMETERS[code] || NON_MASS_PARAMETERS[code] || { family: "other", basis: null }; }
function roundSum(values) {
  const present = values.map(numeric).filter(n => n !== null);
  return present.length ? Number(present.reduce((a, b) => a + b, 0).toFixed(10)) : null;
}
function assertComplete(capture) {
  const r = capture.data && capture.data.Results;
  if (!r || r.Message !== "Success") throw new Error("Unsuccessful original response: " + capture.id);
  if (Array.isArray(r.Results)) {
    if (Number(r.PageCount) !== 1 || Number(r.QueryRows) !== r.Results.length || Number(r.StartRec) !== 1 || Number(r.EndRec) !== r.Results.length)
      throw new Error("Incomplete source page: " + capture.id);
  }
  return r;
}
function flattenEffluent(capture) {
  const result = assertComplete(capture), rows = [];
  if (result.SourceId !== capture.permit) throw new Error("Permit mismatch: " + capture.id);
  for (const [fi, feature] of result.PermFeatures.entries()) {
    for (const [pi, parameter] of feature.Parameters.entries()) {
      for (const [ri, record] of parameter.DischargeMonitoringReports.entries()) {
        const def = selected(parameter.ParameterCode);
        rows.push({
          SourceId: result.SourceId, CWPName: result.CWPName, RegistryId: result.RegistryId,
          ...originalScalarFields(feature, ["Parameters"]),
          ...originalScalarFields(parameter, ["DischargeMonitoringReports"]),
          ...originalScalarFields(record),
          parameter_family: def.family, parameter_mass_basis: def.basis,
          period_end_iso: isoDate(record.MonitoringPeriodEndDate),
          derived_period_start_iso: periodStart(record.MonitoringPeriodEndDate, record.NmbrOfSubmission),
          period_start_method: "calendar months from original NmbrOfSubmission, when positive and ending on month-end",
          reported_numeric_value: numeric(record.DMRValueNmbr),
          standard_numeric_value: numeric(record.DMRValueStdUnits),
          standard_value_unit: record.StdUnitDesc,
          ...origin(capture, "/Results/PermFeatures/" + fi + "/Parameters/" + pi + "/DischargeMonitoringReports/" + ri)
        });
      }
    }
  }
  return rows;
}
function flattenLoads(capture, capturedAt) {
  const retrievedYear = +capturedAt.slice(0, 4), captureDate = capturedAt.slice(0, 10);
  const result = assertComplete(capture), annual = capture.family.startsWith("annual");
  return result.Results.map((row, index) => ({
    ...originalScalarFields(row),
    parameter_family: selected(row.ParameterCode).family,
    parameter_mass_basis: selected(row.ParameterCode).basis,
    query_estimation: capture.estimation,
    query_non_detect: "ZERO",
    query_load_source: "DMR",
    query_parameter_group: "N",
    source_record_basis: annual ? "EPA published annual loading output" : "EPA calculated monitoring-period load from DMR selections",
    published_load_numeric: numeric(annual ? row.PollutantLoad : row.PollutantLoad0),
    published_load_unit: NON_MASS_PARAMETERS[row.ParameterCode] ? null : (annual ? "kg/year" : "kg/monitoring_period"),
    calculation_dimension: NON_MASS_PARAMETERS[row.ParameterCode] ? "non_mass" : "mass",
    published_wastewater_volume_numeric: numeric(row.WastewaterFlow),
    published_wastewater_volume_unit: annual ? "million_US_gallons/year" : "million_US_gallons/monitoring_period",
    published_average_concentration_numeric: numeric(annual ? row.AvgConcentration : row.AvgConcentration0),
    published_average_concentration_unit: NON_MASS_PARAMETERS[row.ParameterCode] ? null : "mg/L",
    published_average_daily_load_numeric: numeric(annual ? row.AvgPollutantLoad : row.AvgPollutantLoad0),
    published_average_daily_load_unit: NON_MASS_PARAMETERS[row.ParameterCode] ? null : "kg/day",
    published_average_daily_flow_numeric: numeric(row.AvgWastewaterFlow),
    published_average_daily_flow_unit: "million_US_gallons/day",
    period_end_iso: annual ? null : isoDate(row.Mped),
    period_status_at_capture: annual ? null : (isoDate(row.Mped) > captureDate ? "future_period_in_original_source" : "ended_by_capture_date"),
    derived_period_start_iso: annual ? null : periodStart(row.Mped, row.NmbrOfReport),
    period_start_method: annual ? null : "calendar months from original NmbrOfReport, when positive and ending on month-end",
    annual_coverage_status: annual ? (+row.DmrYear >= retrievedYear ? "current_year_partial_at_capture" : "historical_year_as_published") : null,
    ...origin(capture, "/Results/Results/" + index)
  }));
}
function loadKey(row) {
  return [row.ExternalPermitNmbr, row.PermFeatureNmbr, row.MonitoringLocationCode, row.ParameterCode].join("|");
}
function inventory(measurements) {
  const groups = new Map();
  for (const r of measurements) {
    const key = [r.SourceId, r.PermFeatureNmbr, r.MonitoringLocationCode, r.ParameterCode].join("|");
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(r);
  }
  return [...groups.values()].map(rows => {
    const r = rows[0];
    return {
      SourceId: r.SourceId, CWPName: r.CWPName, PermFeatureNmbr: r.PermFeatureNmbr,
      PermFeatureTypeCode: r.PermFeatureTypeCode, PermFeatureTypeDesc: r.PermFeatureTypeDesc,
      MonitoringLocationCode: r.MonitoringLocationCode, MonitoringLocationDesc: r.MonitoringLocationDesc,
      ParameterCode: r.ParameterCode, ParameterDesc: r.ParameterDesc, parameter_family: r.parameter_family,
      parameter_mass_basis: r.parameter_mass_basis, measurement_rows: rows.length,
      period_ends: JSON.stringify([...new Set(rows.map(x => x.period_end_iso))].sort()),
      standard_units: JSON.stringify([...new Set(rows.map(x => x.StdUnitDesc))]),
      value_types: JSON.stringify([...new Set(rows.map(x => x.ValueTypeCode))]),
      statistical_bases: JSON.stringify([...new Set(rows.map(x => x.StatisticalBaseCode))]),
      qualifiers: JSON.stringify([...new Set(rows.map(x => x.DMRValueQualifierCode))]),
      nodi_codes: JSON.stringify([...new Set(rows.map(x => x.NODICode).filter(x => x !== null))]),
      limit_types: JSON.stringify([...new Set(rows.map(x => x.LimitTypeCode))]),
      source_response_id: r.source_response_id
    };
  });
}
function massContext(annualN, annualY, periods) {
  const indexedY = new Map(annualY.map(r => [loadKey(r), r]));
  return annualN.filter(r => r.DmrYear === "2023").map(a => {
    const key = loadKey(a), rows = periods.filter(r => loadKey(r) === key), y = indexedY.get(key);
    const numericRows = rows.filter(r => numeric(r.PollutantLoad0) !== null);
    const monthEnds = [...new Set(rows.map(r => r.period_end_iso))].sort();
    const total = roundSum(rows.map(r => r.PollutantLoad0));
    const publishedN = numeric(a.PollutantLoad), publishedY = numeric(y && y.PollutantLoad);
    return {
      ExternalPermitNmbr: a.ExternalPermitNmbr, FacilityName: a.FacilityName,
      PermFeatureNmbr: a.PermFeatureNmbr, MonitoringLocationCode: a.MonitoringLocationCode,
      ParameterCode: a.ParameterCode, ParameterDesc: a.ParameterDesc,
      parameter_family: a.parameter_family, parameter_mass_basis: a.parameter_mass_basis,
      period_rows: rows.length, numeric_load_periods: numericRows.length,
      nonnumeric_load_periods: rows.length - numericRows.length,
      original_period_ends: JSON.stringify(monthEnds),
      original_months_per_report: JSON.stringify([...new Set(rows.map(r => r.NmbrOfReport))]),
      sum_of_available_reported_period_load_kg: total,
      period_sum_method: "sum original numeric PollutantLoad0 once per original loading row; no extrapolation; missing fields excluded and counted",
      published_annual_query_est_N_kg: publishedN, published_annual_query_est_N_raw: a.PollutantLoad,
      published_est_factor_query_N: a.EstFactor,
      published_annual_query_est_Y_kg: publishedY, published_annual_query_est_Y_raw: y ? y.PollutantLoad : null,
      published_est_factor_query_Y: y ? y.EstFactor : null,
      annual_query_N_minus_period_sum_kg: total !== null && publishedN !== null ? Number((publishedN - total).toFixed(10)) : null,
      annual_est_N_and_Y_same_load: publishedN !== null && publishedY !== null ? publishedN === publishedY : null,
      numeric_qualifier_codes: JSON.stringify([...new Set(rows.flatMap(r => [r.Q1Qual,r.Q2Qual,r.C1Qual,r.C2Qual,r.C3Qual]).filter(v => v !== null))]),
      nodi_descriptions: JSON.stringify([...new Set(rows.map(r => r.NodiDesc).filter(v => v !== null))]),
      non_detect_flags: JSON.stringify([...new Set(rows.map(r => r.NdFlag).filter(v => v !== null))]),
      annual_source_response_id: a.source_response_id,
      estimated_comparator_source_response_id: y ? y.source_response_id : null,
      monitoring_period_source_response_id: rows[0] ? rows[0].source_response_id : null,
      interpretation: a.ParameterCode === "00600" && ["SC0042994","SC0047856"].includes(a.ExternalPermitNmbr)
        ? "11 reported periods; published annual loads include an annualization difference even in the p_est=N response; retain period sum separately"
        : "preserve published annual and reported-period quantities separately; never sum constituent species with reported totals"
    };
  });
}
function requestedCoverage(measurements) {
  const permits = [...new Set(measurements.map(r => r.SourceId))].sort();
  return permits.flatMap(permit => Object.entries(TARGET_PARAMETERS).map(([code, definition]) => {
    const rows = measurements.filter(r => r.SourceId === permit && r.ParameterCode === code);
    return {
      SourceId: permit, ParameterCode: code, requested_family: definition.family, parameter_mass_basis: definition.basis,
      coverage_status: rows.length ? "present_in_original_2023_response" : "not_present_in_original_2023_response",
      measurement_rows: rows.length, original_parameter_descriptions: JSON.stringify([...new Set(rows.map(r => r.ParameterDesc))]),
      permitted_features: JSON.stringify([...new Set(rows.map(r => r.PermFeatureNmbr))]),
      monitoring_locations: JSON.stringify([...new Set(rows.map(r => r.MonitoringLocationCode))]),
      source_response_id: measurements.find(r => r.SourceId === permit).source_response_id
    };
  }));
}
function historyContext(annualN, annualY, periods, capturedAt) {
  const captureDate = capturedAt.slice(0, 10), groups = new Map();
  const key = (r, y) => [y, r.ExternalPermitNmbr, r.PermFeatureNmbr, r.MonitoringLocationCode, r.ParameterCode].join("|");
  const add = (r, y, category) => {
    const k = key(r, y);
    if (!groups.has(k)) groups.set(k, { year: String(y), reference: r, annualN: [], annualY: [], periods: [] });
    groups.get(k)[category].push(r);
  };
  annualN.forEach(r => add(r, r.DmrYear, "annualN"));
  annualY.forEach(r => add(r, r.DmrYear, "annualY"));
  periods.forEach(r => add(r, r.period_end_iso.slice(0, 4), "periods"));
  const months = (rows, year) => {
    const all = new Set();
    for (const r of rows) {
      if (!r.derived_period_start_iso || r.period_end_iso > captureDate) continue;
      const start = new Date(r.derived_period_start_iso + "T00:00:00Z"), end = new Date(r.period_end_iso + "T00:00:00Z");
      for (const date = new Date(start); date <= end; date.setUTCMonth(date.getUTCMonth() + 1)) {
        if (String(date.getUTCFullYear()) === year) all.add(date.toISOString().slice(0, 7));
      }
    }
    return [...all].sort();
  };
  const annualRecords = rows => rows.map(r => ({
    source_response_id: r.source_response_id, source_json_pointer: r.source_json_pointer,
    PollutantLoad: r.PollutantLoad, EstFactor: r.EstFactor, NdFlag: r.NdFlag,
    AvgConcentration: r.AvgConcentration, AvgPollutantLoad: r.AvgPollutantLoad,
    WastewaterFlow: r.WastewaterFlow, LatitudeMeasure: r.LatitudeMeasure, LongitudeMeasure: r.LongitudeMeasure
  }));
  return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([groupKey, g]) => {
    const r = g.reference, mass = !NON_MASS_PARAMETERS[r.ParameterCode];
    const ended = g.periods.filter(p => p.period_end_iso <= captureDate);
    const numericPeriods = ended.filter(p => numeric(p.PollutantLoad0) !== null);
    const nonnumeric = ended.filter(p => numeric(p.PollutantLoad0) === null);
    const valuesN = g.annualN.map(a => numeric(a.PollutantLoad)).filter(n => n !== null);
    const valuesY = g.annualY.map(a => numeric(a.PollutantLoad)).filter(n => n !== null);
    const sum = mass ? roundSum(numericPeriods.map(p => p.PollutantLoad0)) : null;
    const n = valuesN.length === 1 ? valuesN[0] : null, y = valuesY.length === 1 ? valuesY[0] : null;
    const periodKeys = new Set(g.periods.map(p => [p.Mped,p.LimitSetDesignator,p.LimitSeasonID].join("|")));
    if (periodKeys.size !== g.periods.length) throw new Error("Repeated original monitoring-period identity: " + groupKey);
    return {
      reporting_year: g.year, ExternalPermitNmbr: r.ExternalPermitNmbr, FacilityName: r.FacilityName,
      PermFeatureNmbr: r.PermFeatureNmbr, MonitoringLocationCode: r.MonitoringLocationCode,
      ParameterCode: r.ParameterCode, ParameterDesc: r.ParameterDesc,
      parameter_family: selected(r.ParameterCode).family, parameter_mass_basis: selected(r.ParameterCode).basis,
      calculation_dimension: mass ? "mass" : "non_mass",
      original_period_rows: g.periods.length, ended_period_rows: ended.length,
      future_period_rows: g.periods.length - ended.length, numeric_load_periods: numericPeriods.length,
      nonnumeric_load_periods: nonnumeric.length,
      numeric_period_load_sum_kg: sum,
      period_sum_method: mass ? "sum available original PollutantLoad0 for periods ending in reporting year and by capture; no extrapolation or cross-year proration" : "non-mass source parameter; original rows retained without a kilogram subtotal",
      reported_period_ends: JSON.stringify(ended.map(p => p.period_end_iso).sort()),
      year_months_with_period_rows: JSON.stringify(months(ended, g.year)),
      year_months_with_numeric_load: JSON.stringify(months(numericPeriods, g.year)),
      periods_crossing_calendar_year: ended.filter(p => p.derived_period_start_iso && p.derived_period_start_iso.slice(0, 4) !== g.year).length,
      original_months_per_report: JSON.stringify([...new Set(g.periods.map(p => p.NmbrOfReport))]),
      annual_rows_query_N: g.annualN.length, annual_rows_query_Y: g.annualY.length,
      annual_numeric_rows_query_N: valuesN.length, annual_numeric_rows_query_Y: valuesY.length,
      published_single_numeric_annual_query_N_kg: mass ? n : null,
      published_single_numeric_annual_query_Y_kg: mass ? y : null,
      annual_query_N_minus_period_sum_kg: mass && n !== null && sum !== null ? Number((n - sum).toFixed(10)) : null,
      annual_query_Y_minus_period_sum_kg: mass && y !== null && sum !== null ? Number((y - sum).toFixed(10)) : null,
      published_annual_original_rows_query_N: JSON.stringify(annualRecords(g.annualN)),
      published_annual_original_rows_query_Y: JSON.stringify(annualRecords(g.annualY)),
      annual_source_multiple_rows: g.annualN.length > 1 || g.annualY.length > 1,
      annual_coverage_status: g.year === capturedAt.slice(0, 4) ? "current_year_partial_at_capture" : "historical_reporting_year",
      nodi_descriptions: JSON.stringify([...new Set(ended.map(p => p.NodiDesc).filter(v => v !== null))]),
      non_detect_flags: JSON.stringify([...new Set(ended.map(p => p.NdFlag).filter(v => v !== null))]),
      measurement_types: JSON.stringify([...new Set(ended.map(p => p.MeasurementType))]),
      period_source_rows: JSON.stringify(g.periods.map(p => ({source_response_id:p.source_response_id,source_json_pointer:p.source_json_pointer})))
    };
  });
}
function assembleEpaTables(captures, capturedAt) {
  const retrievalYear = +capturedAt.slice(0, 4);
  const measurements = captures.filter(c => c.family === "effluent").flatMap(flattenEffluent);
  const annualN = captures.filter(c => c.family === "annual" && c.estimation === "N").flatMap(c => flattenLoads(c, capturedAt));
  const annualY = captures.filter(c => c.family === "annual" && c.estimation === "Y").flatMap(c => flattenLoads(c, capturedAt));
  const periods = captures.filter(c => c.family === "monitoring_period").flatMap(c => flattenLoads(c, capturedAt));
  const allPeriods = [...periods, ...captures.filter(c => c.family === "monitoring_period_history").flatMap(c => flattenLoads(c, capturedAt))];
  const allAnnualY = [...annualY, ...captures.filter(c => c.family === "annual_estimation_history").flatMap(c => flattenLoads(c, capturedAt))];
  const coordinateCapture = captures.find(c => c.family === "facility_coordinates");
  const facilityCoordinates = assertComplete(coordinateCapture).Facilities.map((r, i) => ({
    ...originalScalarFields(r), coordinate_role: "facility_reference_point", coordinate_crs: "EPSG:4269",
    coordinate_method_source: "EPA CWA original CollectionMethod and ReferencePoint fields",
    ...origin(coordinateCapture, "/Results/Facilities/" + i)
  }));
  const unique = new Map();
  for (const row of [...annualN, ...periods]) {
    const key = [row.ExternalPermitNmbr, row.PermFeatureNmbr, row.LatitudeMeasure, row.LongitudeMeasure].join("|");
    if (!unique.has(key)) unique.set(key, {
      ExternalPermitNmbr: row.ExternalPermitNmbr, FacilityName: row.FacilityName, PermFeatureNmbr: row.PermFeatureNmbr,
      LatitudeMeasure: row.LatitudeMeasure, LongitudeMeasure: row.LongitudeMeasure,
      coordinate_role: "ICIS_NPDES_permit_feature", coordinate_units: "decimal_degrees",
      coordinate_method: null, coordinate_method_state: "not included in captured loading service",
      source_geocode_latitude: row.GeocodeLatitude, source_geocode_longitude: row.GeocodeLongitude,
      source_huc12: row.Huc12, source_reach_code: row.Reachcode,
      first_source_response_id: row.source_response_id, first_source_json_pointer: row.source_json_pointer,
      source_uri: row.source_uri
    });
  }
  const facilityProfiles = captures.filter(c => c.family === "facility").map(c => ({
    ExternalPermitNmbr: c.permit, ...originalScalarFields(assertComplete(c).FacilityInfo),
    ...origin(c, "/Results/FacilityInfo")
  }));
  return {
    "dmr_measurements_2023.csv": measurements,
    "dmr_loads_monitoring_period_2023.csv": periods,
    "dmr_annual_history_2007_2026.csv": annualN,
    "dmr_annual_estimation_2023.csv": annualY,
    "dmr_2023_mass_context.csv": massContext(annualN, annualY, periods),
    "dmr_parameter_inventory_2023.csv": inventory(measurements),
    "dmr_requested_parameter_coverage_2023.csv": requestedCoverage(measurements),
    "dmr_facility_coordinates.csv": facilityCoordinates,
    "dmr_permit_feature_coordinates.csv": [...unique.values()],
    "dmr_facility_profiles.csv": facilityProfiles,
    "dmr_loads_monitoring_period_history_2007_2026.csv": allPeriods,
    "dmr_annual_estimation_history_2007_2026.csv": allAnnualY,
    "dmr_annual_period_history_context.csv": historyContext(annualN, allAnnualY, allPeriods, capturedAt)
  };
}
function csvString(rows) {
  const fields = [...new Set(rows.flatMap(r => Object.keys(r)))];
  const quote = v => {
    if (v === null || v === undefined) return "";
    const s = typeof v === "object" ? JSON.stringify(v) : String(v);
    return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  return fields.map(quote).join(",") + "\n" + rows.map(r => fields.map(k => quote(r[k])).join(",")).join("\n") + "\n";
}
export { TARGET_PARAMETERS, numeric, isoDate, periodStart, assembleEpaTables, csvString };
