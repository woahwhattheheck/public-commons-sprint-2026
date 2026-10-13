// Offline, grayscale inspection of retained paired sampling sensitivity.
const escapeHtml = value => String(value ?? "").replace(/[&<>"']/g,
  character => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[character]));
const format = value => value === null ? "—" : Number(value.toFixed(6)).toString();
const interval = row => row.n === 0 ? "No retained pairs" :
  (row.mean_lower_open ? "(" : "[") + format(row.mean_lower) + ", " +
  format(row.mean_upper) + (row.mean_upper_open ? ")" : "]");
const table = (headers, rows) => '<div class="table"><table><thead><tr>' +
  headers.map(value => "<th>" + escapeHtml(value) + "</th>").join("") +
  "</tr></thead><tbody>" + rows.map(row => "<tr>" + row.map(value =>
    "<td>" + escapeHtml(value) + "</td>").join("") + "</tr>").join("") + "</tbody></table></div>";

export function renderPairedSensitivity(result) {
  const full = result.scenarios.filter(row => row.scenario === "all");
  const years = result.scenarios.filter(row => row.scenario === "year_only" || row.scenario === "omit_year");
  const sameDate = result.stability.filter(row => row.single_date_direction_stable).length;
  const sameFlow = result.stability.filter(row =>
    row.lower_flow_n > 0 && row.lower_flow_direction === row.original_mean_direction).length;
  const data = JSON.stringify(result).replace(/[<>&]/g,
    character => "\\u" + character.charCodeAt(0).toString(16).padStart(4, "0"));
  const controls = '<section aria-labelledby="inspect"><h2 id="inspect">Inspect every selection</h2>' +
    '<div class="controls"><label>Station pair / analyte<select id="group">' +
    result.stability.map(row => '<option value="' + escapeHtml(row.group) + '">' +
      escapeHtml(row.station_a + " → " + row.station_b + " · " + row.analyte) + "</option>").join("") +
    '</select></label><label>Selection<select id="scenario"><option value="all">All original dates</option>' +
    '<option value="omit_date">Remove one paired sampling date</option><option value="year_only">One calendar year</option>' +
    '<option value="omit_year">Remove one calendar year</option>' +
    '<option value="exclude_upper_decile_flow">Exclude upper-decile reference flow</option></select></label></div>' +
    '<p id="selection-summary" aria-live="polite"></p><div id="selected-table"></div></section>';
  const script = String.raw`(function () {
    const data = JSON.parse(document.getElementById("source-data").textContent);
    const group = document.getElementById("group"), scenario = document.getElementById("scenario");
    const target = document.getElementById("selected-table");
    const number = value => value === null ? "—" : Number(value.toFixed(6)).toString();
    function cell(row, value) {
      const element = document.createElement("td"); element.textContent = String(value);
      row.appendChild(element);
    }
    function update() {
      const records = data.scenarios.filter(row => row.group === group.value && row.scenario === scenario.value);
      const table = document.createElement("table"), head = table.createTHead().insertRow();
      ["Selection", "Retained pairs", "Excluded pairs", "Mean B − A (mg/L)", "Mean direction", "Original data rows"].forEach(label => {
        const element = document.createElement("th"); element.textContent = label; head.appendChild(element);
      });
      const body = table.createTBody();
      for (const value of records) {
        const row = body.insertRow();
        const bounds = value.n ? (value.mean_lower_open ? "(" : "[") +
          number(value.mean_lower) + ", " + number(value.mean_upper) + (value.mean_upper_open ? ")" : "]") :
          "No retained pairs";
        [value.selection, value.n, value.excluded_n, bounds, value.mean_direction,
          value.included_source_data_rows.join(", ")].forEach(item => cell(row, item));
      }
      const wrapper = document.createElement("div"); wrapper.className = "table"; wrapper.appendChild(table);
      target.replaceChildren(wrapper);
      document.getElementById("selection-summary").textContent =
        records.length + " selections. Data-row numbers are one-based in the unchanged paired CSV, excluding its header.";
    }
    group.addEventListener("change", update); scenario.addEventListener("change", update); update();
  }());`;
  return '<!doctype html><html lang="en"><head><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<title>Eighteenmile paired sampling sensitivity</title><style>' +
    ':root{color-scheme:light;font-family:Arial,Helvetica,sans-serif;color:#202020;background:#f4f4f4}' +
    'body{margin:0}main{max-width:1160px;margin:0 auto;padding:36px 28px 60px;background:#fff}' +
    'h1{font-size:30px;line-height:1.2;margin:12px 0 18px}h2{font-size:21px;margin:32px 0 12px}' +
    'p,li{line-height:1.55;max-width:98ch}a{color:inherit;text-decoration:underline;text-underline-offset:3px}' +
    '.meta{font-size:12px;color:#555;letter-spacing:.04em;text-transform:uppercase}.lead{font-size:18px}' +
    '.table{overflow:auto;border:1px solid #ccc;margin:14px 0}table{border-collapse:collapse;width:100%;font-size:13px}' +
    'th,td{padding:9px 10px;text-align:left;vertical-align:top;border-bottom:1px solid #ddd}th{background:#eee;font-weight:600}' +
    'tbody tr:last-child td{border-bottom:0}.controls{display:flex;gap:16px;flex-wrap:wrap}label{display:grid;gap:6px;font-size:13px}' +
    'select{font:inherit;padding:9px;background:#fff;color:#222;border:1px solid #777;max-width:100%}' +
    '.notice{padding:14px 18px;border-left:3px solid #555;background:#f3f3f3}code{overflow-wrap:anywhere;font-size:12px}' +
    '@media(max-width:600px){main{padding:24px 14px}h1{font-size:26px}.controls{display:block}label{margin-bottom:12px}}' +
    '@media print{body,main{background:white}main{max-width:none;padding:0}.controls,#selection-summary,#selected-table{display:none}.table{overflow:visible}thead{display:table-header-group}tr{break-inside:avoid}a{color:#222}}' +
    '</style></head><body><main><p class="meta">Upper Savannah · Observed nutrient study · Retained paired comparisons</p>' +
    '<h1>Eighteenmile paired sampling sensitivity</h1><p class="lead">' +
    sameDate + ' of ' + result.stability.length + ' station-and-analyte comparisons retain their mean direction after removal of any one paired sampling date. ' +
    sameFlow + ' of ' + result.stability.length + ' retain that direction after excluding upper-decile reference-flow days.</p>' +
    '<p>The analysis uses ' + result.counts.original_comparisons + ' original nitrogen/phosphorus comparisons from ' +
    result.counts.station_pair_dates + ' station-pair/date combinations on ' + result.counts.unique_sampling_dates +
    ' sampling dates. Each station pair and analyte is analyzed separately. ' +
    '<a href="nutrient-flow-study.html">Open the complete original nutrient-and-flow study</a>.</p>' +
    '<div class="notice"><strong>Read the sign by station identifier.</strong> Every difference is B minus A. ' +
    'An interval entirely above zero establishes a higher paired mean at B; an interval entirely below zero establishes a lower paired mean. ' +
    'Open endpoints preserve the original quantitation limits. These bounds describe censoring in the retained observations.</div>' +
    '<h2>Original paired means</h2>' +
    table(["Station A","Station B","Analyte","Paired dates","Mean B − A (mg/L)","Mean direction","Pairs higher / lower / unresolved"],
      full.map(row => [row.station_a,row.station_b,row.analyte,row.n,interval(row),row.mean_direction,
        row.b_higher + " / " + row.b_lower + " / " + row.unresolved])) +
    '<h2>Remove one date at a time</h2><p>Every case removes one date within its station-and-analyte cohort. ' +
    'The table reports how often the original definite mean direction survives. Source observations shared by different station pairs remain separate comparisons.</p>' +
    table(["A → B","Analyte","Cases","Same mean direction","Lowest mean lower bound","Highest mean upper bound"],
      result.stability.map(row => [row.station_a + " → " + row.station_b,row.analyte,
        row.omission_cases,row.omissions_same_direction,format(row.omission_mean_lower_min),format(row.omission_mean_upper_max)])) +
    '<p class="meta">The last two columns span different omission cases. Inspect a specific case below for its endpoint openness and exact source rows.</p>' +
    '<h2>Dates with the largest mean-endpoint effect</h2><p>Mean direction survives every individual removal, while the magnitude can change materially. ' +
    'For each cohort, the date below produces the largest absolute change in either mean interval endpoint. All removal cases remain available below. Individual paired dates can have the opposite sign from their cohort mean. Read the retained flow percentile alongside the effect: excluding high-flow days can retain influential low-flow observations.</p>' +
    table(["A → B","Analyte","Removed date","Mean B − A after removal (mg/L)","Endpoint shift (mg/L)","Reference flow (ft³/s)","Annual flow percentile"],
      result.stability.filter(row => row.largest_endpoint_shift).map(row => {
        const effect = row.largest_endpoint_shift;
        return [row.station_a + " → " + row.station_b,row.analyte,effect.excluded_date,
          interval({n: row.original_n - 1,mean_lower: effect.mean_lower,mean_upper: effect.mean_upper,
            mean_lower_open: effect.lower_open,mean_upper_open: effect.upper_open}),format(effect.shift_mg_l),
          format(effect.reference_flow_cfs),format(effect.annual_flow_percentile)];
      })) +
    '<h2>Reference-flow selection</h2><p>This selection keeps only dates with a recorded annual midrank flow percentile below 90. ' +
    'Missing percentiles are excluded and counted separately. Gauge 02186702 supplies whole-catchment context; these results retain the original station comparison and do not infer station-specific discharge.</p>' +
    table(["A → B","Analyte","Retained pairs","Missing flow pairs","Mean B − A (mg/L)","Mean direction"],
      result.scenarios.filter(row => row.scenario === "exclude_upper_decile_flow").map(row =>
        [row.station_a + " → " + row.station_b,row.analyte,row.n,row.missing_flow_pairs,interval(row),row.mean_direction])) +
    '<h2>Calendar-year sensitivity</h2><p>Read the year-specific cohorts alongside removal of an entire year. ' +
    'Unequal counts describe the actual paired sampling coverage. A whole-cohort result need not hold in every individual year.</p>' +
    table(["A → B","Analyte","Selection","Year","Paired dates","Mean B − A (mg/L)","Mean direction"],
      years.map(row => [row.station_a + " → " + row.station_b,row.analyte,
        row.scenario === "year_only" ? "Only this year" : "Exclude this year",
        row.selection,row.n,interval(row),row.mean_direction])) +
    controls + '<noscript><p>The static tables above remain available. Download the complete CSV and JSON for every individual omission case.</p></noscript>' +
    '<h2>Methods and original records</h2><p>Each original pair has equal weight. Lower and upper difference endpoints are summed using exact 12-decimal integer arithmetic; means are rounded only after division. ' +
    'The exact endpoint sums, divisor, endpoint openness and included original data rows accompany all ' + result.counts.scenarios +
    ' selections. The result evaluates sensitivity to the available sampling dates, calendar years and reference-flow selection. Sampling uncertainty, laboratory error and causal attribution require separate analyses.</p>' +
    '<ul><li><a href="paired-sensitivity.json">Complete result and exact endpoint sums</a></li>' +
    '<li><a href="paired-sensitivity-scenarios.csv">Every retained selection</a></li>' +
    '<li><a href="paired-station-contrasts.csv">Unchanged original paired comparisons</a></li>' +
    '<li><a href="PAIRED_SENSITIVITY.md">Reproduction and source notes</a></li></ul>' +
    '<p>Original paired source: <a href="' + escapeHtml(result.source.source_url) + '">immutable merged study</a>. ' +
    escapeHtml(result.source.bytes) + ' bytes; SHA-256 <code>' + escapeHtml(result.source.sha256) + '</code>.</p>' +
    '<script id="source-data" type="application/json">' + data + '</script><script>' + script + '</script>' +
    '</main></body></html>\n';
}
