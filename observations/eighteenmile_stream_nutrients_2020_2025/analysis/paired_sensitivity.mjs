// Paired sampling sensitivity using the original interval-valued comparisons.
const SCALE = 1000000000000n;
const ANALYTES = ["Reconstructed total N", "Phosphorus"];
const decimal = (value, label) => {
  const match = /^(-?)(\d+)(?:\.(\d{1,12}))?$/.exec(String(value));
  if (!match) throw Error("Invalid retained decimal: " + label);
  const magnitude = BigInt(match[2]) * SCALE + BigInt((match[3] || "").padEnd(12, "0"));
  return match[1] ? -magnitude : magnitude;
};
const flag = (value, label) => {
  if (value === true || value === "true") return true;
  if (value === false || value === "false") return false;
  throw Error("Invalid endpoint flag: " + label);
};
const number = value => Number(value.toFixed(12));
const direction = (lower, upper, lowerOpen, upperOpen) =>
  lower > 0n || lower === 0n && lowerOpen ? "B higher" :
  upper < 0n || upper === 0n && upperOpen ? "B lower" :
  lower === 0n && upper === 0n ? "equal" : "unresolved by censor intervals";

function normalize(row, index) {
  for (const key of ["date", "analyte", "station_a", "station_b", "activity_a", "activity_b"]) {
    if (typeof row[key] !== "string" || !row[key]) throw Error("Missing " + key);
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(row.date) || !ANALYTES.includes(row.analyte)) {
    throw Error("Unexpected original date or analyte");
  }
  const lower = decimal(row.difference_b_minus_a_lower, "difference lower");
  const upper = decimal(row.difference_b_minus_a_upper, "difference upper");
  const lowerOpen = flag(row.difference_lower_open, "difference lower openness");
  const upperOpen = flag(row.difference_upper_open, "difference upper openness");
  if (lower > upper || lower === upper && (lowerOpen || upperOpen)) {
    throw Error("Empty retained comparison interval");
  }
  const percentile = row.flow_percentile === "" || row.flow_percentile == null
    ? null : Number(row.flow_percentile);
  if (percentile !== null && (!Number.isFinite(percentile) || percentile < 0 || percentile > 100)) {
    throw Error("Invalid retained annual flow percentile");
  }
  const expected = direction(lower, upper, lowerOpen, upperOpen);
  if (row.direction !== expected) throw Error("Original interval direction differs at data row " + (index + 1));
  return {source: row, source_data_row: index + 1, lower, upper, lowerOpen, upperOpen,
    percentile, year: row.date.slice(0, 4)};
}

function summarize(rows) {
  if (!rows.length) return {n: 0, mean_lower: null, mean_upper: null,
    mean_lower_open: false, mean_upper_open: false, mean_direction: "no retained pairs",
    lower_sum_scaled: "0", upper_sum_scaled: "0", decimal_scale: 12,
    b_higher: 0, b_lower: 0, equal: 0, unresolved: 0};
  const lower = rows.reduce((total, row) => total + row.lower, 0n);
  const upper = rows.reduce((total, row) => total + row.upper, 0n);
  const lowerOpen = rows.some(row => row.lowerOpen);
  const upperOpen = rows.some(row => row.upperOpen);
  return {n: rows.length, mean_lower: number(Number(lower) / Number(SCALE) / rows.length),
    mean_upper: number(Number(upper) / Number(SCALE) / rows.length),
    mean_lower_open: lowerOpen, mean_upper_open: upperOpen,
    mean_direction: direction(lower, upper, lowerOpen, upperOpen),
    lower_sum_scaled: String(lower), upper_sum_scaled: String(upper), decimal_scale: 12,
    b_higher: rows.filter(row => row.source.direction === "B higher").length,
    b_lower: rows.filter(row => row.source.direction === "B lower").length,
    equal: rows.filter(row => row.source.direction === "equal").length,
    unresolved: rows.filter(row => row.source.direction === "unresolved by censor intervals").length};
}

export function analyzePairedSensitivity(originalRows, source) {
  const rows = originalRows.map(normalize);
  const keys = new Set();
  const groups = new Map();
  for (const row of rows) {
    const key = [row.source.station_a, row.source.station_b, row.source.analyte].join("|");
    const dateKey = key + "|" + row.source.date;
    if (keys.has(dateKey)) throw Error("Duplicate same-date original pair: " + dateKey);
    keys.add(dateKey);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  const scenarios = [], stability = [];
  for (const [key, cohort] of groups) {
    cohort.sort((a, b) => a.source.date.localeCompare(b.source.date));
    const first = cohort[0].source;
    const add = (kind, selection, selected) => {
      const included = new Set(selected.map(row => row.source_data_row));
      const excluded = cohort.filter(row => !included.has(row.source_data_row));
      const record = {group: key, station_a: first.station_a, station_b: first.station_b,
        analyte: first.analyte, unit: "mg/L", scenario: kind, selection,
        original_n: cohort.length, excluded_n: excluded.length,
        excluded_dates: excluded.map(row => row.source.date),
        included_source_data_rows: selected.map(row => row.source_data_row),
        excluded_source_data_rows: excluded.map(row => row.source_data_row),
        missing_flow_pairs: cohort.filter(row => row.percentile === null).length,
        ...summarize(selected)};
      scenarios.push(record);
      return record;
    };
    const full = add("all", "All original paired dates", cohort);
    const omissions = cohort.map(row => add("omit_date", row.source.date,
      cohort.filter(other => other !== row)));
    for (const year of [...new Set(cohort.map(row => row.year))].sort()) {
      add("year_only", year, cohort.filter(row => row.year === year));
      add("omit_year", year, cohort.filter(row => row.year !== year));
    }
    const lowerFlow = add("exclude_upper_decile_flow", "Known annual flow percentile < 90",
      cohort.filter(row => row.percentile !== null && row.percentile < 90));
    const nonempty = omissions.filter(row => row.n > 0);
    const definite = full.mean_direction === "B higher" || full.mean_direction === "B lower";
    const influential = [...nonempty].sort((a, b) => {
      const shift = row => Math.max(Math.abs(row.mean_lower - full.mean_lower), Math.abs(row.mean_upper - full.mean_upper));
      return shift(b) - shift(a) || a.selection.localeCompare(b.selection);
    })[0];
    stability.push({group: key, station_a: first.station_a, station_b: first.station_b,
      analyte: first.analyte, original_n: cohort.length, original_mean_direction: full.mean_direction,
      omission_cases: omissions.length, nonempty_omission_cases: nonempty.length,
      omissions_same_direction: nonempty.filter(row => row.mean_direction === full.mean_direction).length,
      single_date_direction_stable: definite && nonempty.length === omissions.length &&
        nonempty.every(row => row.mean_direction === full.mean_direction),
      largest_endpoint_shift: influential ? {excluded_date: influential.selection,
        source_data_row: cohort.find(row => row.source.date === influential.selection).source_data_row,
        reference_flow_cfs: Number(cohort.find(row => row.source.date === influential.selection).source.flow_cfs),
        annual_flow_percentile: cohort.find(row => row.source.date === influential.selection).percentile,
        mean_lower: influential.mean_lower, mean_upper: influential.mean_upper,
        lower_open: influential.mean_lower_open, upper_open: influential.mean_upper_open,
        shift_mg_l: number(Math.max(Math.abs(influential.mean_lower - full.mean_lower),
          Math.abs(influential.mean_upper - full.mean_upper)))} : null,
      omission_direction_changes: nonempty.filter(row => row.mean_direction !== full.mean_direction)
        .map(row => ({excluded_date: row.selection, direction: row.mean_direction,
          mean_lower: row.mean_lower, mean_upper: row.mean_upper,
          lower_open: row.mean_lower_open, upper_open: row.mean_upper_open})),
      omission_mean_lower_min: nonempty.length ? Math.min(...nonempty.map(row => row.mean_lower)) : null,
      omission_mean_upper_max: nonempty.length ? Math.max(...nonempty.map(row => row.mean_upper)) : null,
      lower_flow_n: lowerFlow.n, lower_flow_direction: lowerFlow.mean_direction,
      lower_flow_mean_lower: lowerFlow.mean_lower, lower_flow_mean_upper: lowerFlow.mean_upper,
      lower_flow_lower_open: lowerFlow.mean_lower_open, lower_flow_upper_open: lowerFlow.mean_upper_open,
      missing_flow_pairs: lowerFlow.missing_flow_pairs});
  }
  return {schema: "eighteenmile.paired-sensitivity/v1", source,
    method: {difference: "station B minus station A", unit: "mg/L",
      weighting: "one equally weighted original same-date station pair per comparison",
      endpoint_arithmetic: "exact integer sums at 12 decimal places; display means rounded after division",
      lower_flow_selection: "retain known original annual reference-gauge midrank percentile below 90",
      gauge_role: "02186702 daily discharge is reference-basin context; station reach flow is not inferred",
      interpretation: "descriptive sensitivity to retained sampling dates, years and reference-flow selection",
      uncertainty: "interval endpoints describe original concentration censoring; sampling uncertainty is separate"},
    counts: {original_comparisons: rows.length,
      unique_sampling_dates: new Set(rows.map(row => row.source.date)).size,
      station_pair_dates: new Set(rows.map(row => [row.source.station_a, row.source.station_b, row.source.date].join("|"))).size,
      station_analyte_groups: groups.size, scenarios: scenarios.length}, stability, scenarios};
}

export function writePairedSensitivityJson(result) {
  const {scenarios, ...summary} = result;
  return JSON.stringify(summary, null, 2).slice(0, -2) + ',\n  "scenarios": [\n' +
    scenarios.map(row => "    " + JSON.stringify(row)).join(",\n") + "\n  ]\n}\n";
}
