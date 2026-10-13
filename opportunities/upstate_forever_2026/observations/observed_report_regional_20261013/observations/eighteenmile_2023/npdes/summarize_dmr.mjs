#!/usr/bin/env node
/**
 * Reproduce the retained Eighteenmile 2023 DMR period and annual quantities.
 * Node.js 18+; standard library only. The original capture and all referenced
 * response bytes are verified before the retained calculation is evaluated.
 */
import {readFile, realpath, mkdir, writeFile} from "node:fs/promises";
import {createHash} from "node:crypto";
import path from "node:path";
import {fileURLToPath} from "node:url";

const PREFIX = "observations/eighteenmile_2023/npdes/";
const SOURCE_CAPTURE_SHA256 = "434dd8d458e646581224878cc4f4f110f91100af25048f30b70765c8e872fe9c";
const digest = bytes => createHash("sha256").update(bytes).digest("hex");

function summarizeDmrCapture(packet) {
  "use strict";
  const PREFIX = "observations/eighteenmile_2023/npdes/";
  const originals = new Map(packet.files.map(file => [file.path, file]));
  const captureFile = originals.get(PREFIX + "capture.json");
  if (!captureFile) throw new Error("Select the complete original DMR capture package");
  const capture = JSON.parse(captureFile.content);
  if (capture.schema !== "upstate.eighteenmile-point-source-capture/v1")
    throw new Error("Original capture schema differs");
  const startYear = 2023;
  const yearStart = Date.UTC(startYear, 0, 1);
  const yearEnd = Date.UTC(startYear + 1, 0, 1);
  const dayMs = 86400000;
  const months = ["JAN","FEB","MAR","APR","MAY","JUN","JUL","AUG","SEP","OCT","NOV","DEC"];
  const decimal = value => {
    if (typeof value !== "string" || !/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(value))
      throw new Error("Expected a nonnegative original decimal: " + value);
    const [integer, fraction = ""] = value.split(".");
    return {n: BigInt((integer || "0") + fraction), s: fraction.length};
  };
  const decimalText = ({n, s}) => {
    if (!s) return n.toString();
    const value = n.toString().padStart(s + 1, "0");
    return (value.slice(0, -s) + "." + value.slice(-s)).replace(/\.?0+$/, "") || "0";
  };
  const add = (a, b) => {
    const s = Math.max(a.s, b.s);
    return {n: a.n * 10n ** BigInt(s-a.s) + b.n * 10n ** BigInt(s-b.s), s};
  };
  const multiplyDays = (value, days) => {
    const parsed = decimal(value);
    return decimalText({n: parsed.n * BigInt(days), s: parsed.s});
  };
  const sum = values => decimalText(values.reduce((a,v) => add(a, decimal(v)), {n:0n,s:0}));
  const date = value => {
    const match = /^(\d{2})-([A-Z]{3})-(\d{2}|\d{4})$/.exec(value || "");
    if (!match || !months.includes(match[2])) throw new Error("Unknown original DMR end date");
    const year = Number(match[3]) + (match[3].length === 2 ? 2000 : 0);
    const month = months.indexOf(match[2]), day = Number(match[1]);
    const time = Date.UTC(year, month, day);
    const actual = new Date(time);
    if (actual.getUTCFullYear() !== year || actual.getUTCMonth() !== month
        || actual.getUTCDate() !== day) throw new Error("Invalid original DMR end date");
    return actual;
  };
  const iso = time => new Date(time).toISOString().slice(0, 10);
  const qualifier = value => value === null ? "" : String(value)
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
  const groups = new Map(), seen = new Set();
  let originalRows = 0;
  const selectedSources = capture.response_sources.filter(s => /^\d{5}$/.test(s.parameter_code || ""));
  for (const source of selectedSources) {
    const file = originals.get(source.path);
    if (!file || file.sha256 !== source.sha256 || file.bytes !== source.bytes)
      throw new Error("Original response binding differs: " + source.path);
    const body = JSON.parse(file.content).Results;
    if (body.SourceId !== source.source_id) throw new Error("Original permit differs");
    for (const feature of body.PermFeatures || []) {
      for (const parameter of feature.Parameters || []) {
        if (parameter.ParameterCode !== source.parameter_code) throw new Error("Original parameter differs");
        for (const row of parameter.DischargeMonitoringReports || []) {
          const key = [body.SourceId, feature.PermFeatureNmbr, parameter.ParameterCode,
                       parameter.MonitoringLocationCode].join("|");
          if (!row.DMRValueId || seen.has(row.DMRValueId))
            throw new Error("Repeated original DMR value identity");
          seen.add(row.DMRValueId);
          originalRows++;
          if (!groups.has(key)) groups.set(key, {permit_id:body.SourceId,
            reporting_feature:feature.PermFeatureNmbr, feature_type:feature.PermFeatureTypeCode,
            feature_type_desc:feature.PermFeatureTypeDesc, parameter_code:parameter.ParameterCode,
            parameter_name:parameter.ParameterDesc, monitoring_location:parameter.MonitoringLocationCode,
            monitoring_location_desc:parameter.MonitoringLocationDesc, source, rows:[]});
          groups.get(key).rows.push(row);
        }
      }
    }
  }
  if (selectedSources.length !== capture.parameter_series_count || originalRows !== capture.record_count)
    throw new Error("Original series/record inventory differs");
  const periods = [], annual = [], selections = [];
  for (const [key, group] of [...groups].sort(([a],[b]) => a.localeCompare(b))) {
    if (group.feature_type !== "EXO" || group.monitoring_location !== "1")
      throw new Error("Review the actual discharge basis before adding this series: " + key);
    const unit = group.parameter_code === "50050" ? "MGD" : "kg/d";
    const candidates = group.rows.filter(row => row.StatisticalBaseCode === "MK"
      && row.StatisticalBaseTypeCode === "AVG" && row.StdUnitDesc === unit);
    const groupedPeriods = new Map();
    for (const row of candidates) {
      const monthCount = Number(row.NmbrOfSubmission);
      if (![1,2,3,4,6,12].includes(monthCount))
        throw new Error("Original reporting duration requires review");
      const end = date(row.MonitoringPeriodEndDate);
      if (end.getUTCDate() !== new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth()+1, 0)).getUTCDate())
        throw new Error("The reported period does not end on a calendar month end");
      const periodStart = Date.UTC(end.getUTCFullYear(), end.getUTCMonth()-monthCount+1, 1);
      const periodEnd = Date.UTC(end.getUTCFullYear(), end.getUTCMonth()+1, 1);
      const id = iso(periodStart) + "/" + iso(periodEnd);
      if (!groupedPeriods.has(id)) groupedPeriods.set(id, {start:periodStart,end:periodEnd,monthCount,rows:[]});
      groupedPeriods.get(id).rows.push(row);
    }
    const values = [], allIntervals = [], knownIntervals = [], selectedRecordIds = [];
    let pairedQualified = 0, unknownDetection = 0, parallelNoDischarge = 0;
    const allPeriodRows = [];
    for (const [periodId, period] of [...groupedPeriods].sort(([a],[b]) => a.localeCompare(b))) {
      const inStart = Math.max(period.start, yearStart), inEnd = Math.min(period.end, yearEnd);
      if (inEnd <= inStart) continue;
      const days = (period.end-period.start)/dayMs, yearDays=(inEnd-inStart)/dayMs;
      const populated = period.rows.filter(row => row.DMRValueStdUnits !== null
        && row.DMRValueStdUnits !== "" && !row.NODICode);
      if (populated.length > 1) throw new Error("Multiple populated monthly quantities: " + key + "/" + periodId);
      const noDischarge = period.rows.filter(row => row.NODICode === "C");
      const unresolved = period.rows.filter(row => !["C", null, ""].includes(row.NODICode));
      let selected = populated[0] || null, value = null, status, ids = [];
      if (selected) {
        if (qualifier(selected.DMRValueQualifierCode) !== "=")
          throw new Error("The selected quantity has a bound/estimate qualifier requiring a separate method");
        decimal(selected.DMRValueStdUnits);
        value = selected.DMRValueStdUnits;
        status = "reported_average";
        ids = [selected.DMRValueId];
        parallelNoDischarge += noDischarge.length;
      } else if (!unresolved.length && noDischarge.length === period.rows.length) {
        value = "0";
        status = "reported_no_discharge";
        ids = noDischarge.map(row => row.DMRValueId);
      } else {
        status = unresolved.some(row => row.NODICode === "B")
          ? "detection_threshold_unreported" : "quantity_unreported";
        if (status === "detection_threshold_unreported") unknownDetection++;
      }
      const associated = selected ? group.rows.filter(row =>
        row.DMREventId === selected.DMREventId && row.LimitId === selected.LimitId
        && row.MonitoringPeriodEndDate === selected.MonitoringPeriodEndDate
        && row.StatisticalBaseCode === "MK" && row.StdUnitDesc === "mg/L"
        && row.DMRValueStdUnits !== null && qualifier(row.DMRValueQualifierCode) !== "=") : [];
      if (associated.length) pairedQualified++;
      const amount = value === null ? null : multiplyDays(value, yearDays);
      if (amount !== null) { values.push(amount); knownIntervals.push([inStart,inEnd]); }
      allIntervals.push([inStart,inEnd]);
      selectedRecordIds.push(...ids);
      const record = {series_id:key,permit_id:group.permit_id,reporting_feature:group.reporting_feature,
        parameter_code:group.parameter_code,parameter_name:group.parameter_name,
        monitoring_location:group.monitoring_location,period_start:iso(period.start),
        period_end_exclusive:iso(period.end),reporting_months:period.monthCount,
        period_days:days,calendar_2023_days:yearDays,
        calendar_2023_start:iso(inStart),calendar_2023_end_exclusive:iso(inEnd),
        statistical_base_code:"MK",statistical_base_desc:"MO AVG",statistical_type:"AVG",
        standard_rate:value,standard_rate_unit:unit,
        amount_in_reported_period:value===null?null:multiplyDays(value,days),
        amount_in_2023:amount,amount_unit:unit==="MGD"?"million_US_gallons":"kg",
        status,selected_dmr_value_ids:ids,parallel_no_discharge_ids:populated.length?noDischarge.map(row=>row.DMRValueId):[],
        all_average_candidate_ids:period.rows.map(row=>row.DMRValueId),
        selected_version:selected?.VersionNmbr??null,
        selected_permit_feature_id:selected?.PermFeatureId??null,
        selected_limit_id:selected?.LimitId??null,
        selected_limit_set_id:selected?.LimitSetId??null,
        selected_dmr_event_id:selected?.DMREventId??null,
        paired_concentration_qualifiers:associated.map(row=>({dmr_value_id:row.DMRValueId,
          value:row.DMRValueStdUnits,unit:row.StdUnitDesc,qualifier:qualifier(row.DMRValueQualifierCode)})),
        source_path:group.source.path,source_sha256:group.source.sha256,source_url:group.source.url};
      periods.push(record); allPeriodRows.push(record);
    }
    function intervals(values) {
      const sorted = values.slice().sort((a,b)=>a[0]-b[0]);
      let previous = yearStart, days=0;
      const missing=[];
      for (const [a,b] of sorted) {
        if (a < previous) throw new Error("Overlapping original reporting periods: " + key);
        if (a > previous) missing.push({start:iso(previous),end_exclusive:iso(a),days:(a-previous)/dayMs});
        days += (b-a)/dayMs; previous=b;
      }
      if(previous < yearEnd)missing.push({start:iso(previous),end_exclusive:iso(yearEnd),days:(yearEnd-previous)/dayMs});
      return {days,missing};
    }
    const reported = intervals(allIntervals), quantified = intervals(knownIntervals);
    const known = values.length ? sum(values) : null;
    annual.push({series_id:key,permit_id:group.permit_id,reporting_feature:group.reporting_feature,
      feature_type:group.feature_type,monitoring_location:group.monitoring_location,
      parameter_code:group.parameter_code,parameter_name:group.parameter_name,calendar_year:startYear,
      amount_unit:unit==="MGD"?"million_US_gallons":"kg",
      complete_calendar_year:quantified.days===365,
      annual_total:quantified.days===365?known:null,
      quantified_period_total:known,quantified_days:quantified.days,
      original_reported_days_in_2023:reported.days,period_count:allPeriodRows.length,
      quantified_period_count:values.length,missing_intervals:reported.missing,
      unquantified_intervals:quantified.missing,unknown_detection_periods:unknownDetection,
      selected_quantity_with_qualified_concentration_periods:pairedQualified,
      parallel_no_discharge_records:parallelNoDischarge,selected_dmr_value_ids:selectedRecordIds,
      source_path:group.source.path,source_sha256:group.source.sha256,source_url:group.source.url});
    const selectedIds=new Set(selectedRecordIds);
    for(const row of group.rows)selections.push({series_id:key,dmr_value_id:row.DMRValueId,
      selected:selectedIds.has(row.DMRValueId),statistical_base_code:row.StatisticalBaseCode,
      value_type_code:row.ValueTypeCode,standard_unit:row.StdUnitDesc,
      standard_value:row.DMRValueStdUnits,qualifier:qualifier(row.DMRValueQualifierCode),
      nodi_code:row.NODICode,monitoring_period_end:row.MonitoringPeriodEndDate,
      limit_id:row.LimitId,source_path:group.source.path,source_sha256:group.source.sha256});
  }
  return {schema:"upstate.eighteenmile-reported-period-loads/v1",calendar_year:startYear,
    capture_sha256:captureFile.sha256,original_records:originalRows,original_series:selectedSources.length,
    method:"Reported original MK/AVG standard mass or flow rate multiplied by actual calendar days; one populated quantity per permit/reporting-feature/parameter/location/period. Original record identities and parallel branches are retained.",
    duration_basis:"Continuous discharge across each reported monitoring period; the original full inventories contain no duration-of-discharge parameter.",
    period_convention:"Start inclusive; end exclusive. Period contributions are clipped to calendar 2023. Original full-period days and mass/volume remain separate.",
    units_basis:"DMRValueStdUnits with its original StdUnitDesc; no additional conversion of the EPA-standard quantity.",
    concentration_basis:"Paired concentration qualifiers are retained with the reported mass rate. Nitrogen species and total nitrogen remain separate.",
    annual_basis:"Complete annual total only when quantified periods cover all 365 days; partial observed totals and their exact missing/unquantified intervals are retained.",
    periods,annual,selections};
}

function encodeCsv(rows, columns) {
  const cell = value => {
    if (value === null || value === undefined) return "";
    const text = typeof value === "object" ? JSON.stringify(value) : String(value);
    return /[",\r\n]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
  };
  return [columns.map(cell).join(","), ...rows.map(row =>
    columns.map(column => cell(row[column])).join(","))].join("\n") + "\n";
}

function makeProducts(result, moduleSha256, sha256) {
  const periodColumns = Object.keys(result.periods[0]);
  const annualColumns = Object.keys(result.annual[0]);
  const periods = encodeCsv(result.periods, periodColumns);
  const annual = encodeCsv(result.annual, annualColumns);
  const periodSha = sha256(periods), annualSha = sha256(annual);
  const sourceIds = {
    period_loads: "upstate-eighteenmile-2023-dmr-period-loads-" + periodSha.slice(0, 12),
    annual_loads: "upstate-eighteenmile-2023-dmr-annual-loads-" + annualSha.slice(0, 12)
  };
  const {periods: discardedPeriods, selections, ...summaryBase} = result;
  const summary = {
    ...summaryBase,
    calculation_module: {
      path: "observations/eighteenmile_2023/npdes/summarize_dmr.mjs",
      sha256: moduleSha256
    },
    source_ids: sourceIds,
    output_files: [
      {path:"period_loads.csv",sha256:periodSha,rows:result.periods.length,columns:periodColumns},
      {path:"annual_loads.csv",sha256:annualSha,rows:result.annual.length,columns:annualColumns}
    ],
    selected_original_records: selections.filter(row=>row.selected).length,
    original_record_selection: "Each period row retains all eligible original average candidates and the selected DMRValueIds. The original 980-row dmr_records.csv retains every reported field and nonselected statistical basis.",
    spatial_join: "Join the original state outfall source by permit_id. Preserve the state mapped outfall identifier and the EPA reporting_feature separately; Milliken reports T1M and T1Q while the state mapped feature is 001.",
    model_join: "Retain these 2023 effluent quantities as point-source context. Model nitrogen_export.tif and phosphorus_export.tif contain annual land-cover export mass per cell; use their original scenario and source year alongside this separately dated source.",
    methods_urls: [
      "https://echo.epa.gov/help/reports/effluent-charts-help",
      "https://echo.epa.gov/trends/loading-tool/resources/loading-calculations",
      "https://echo.epa.gov/trends/loading-tool/resources/technical-background-methodology/convert-module"
    ]
  };
  return {
    "period_loads.csv": periods,
    "annual_loads.csv": annual,
    "summary.json": JSON.stringify(summary, null, 2) + "\n"
  };
}

async function main(args = process.argv.slice(2)) {
  if (args.includes("--help")) {
    process.stdout.write("node summarize_dmr.mjs --root APPLICATION [--output DIRECTORY]\n");
    return;
  }
  const options = {};
  for (let i = 0; i < args.length; i += 2) {
    const flag = args[i], value = args[i+1];
    if (!["--root","--output"].includes(flag) || !value || value.startsWith("--")
        || Object.hasOwn(options, flag))
      throw new Error("Use --root APPLICATION and optional --output DIRECTORY exactly once");
    options[flag] = value;
  }
  if (!options["--root"]) throw new Error("Select --root APPLICATION containing the original capture");
  const root = await realpath(options["--root"]);
  async function original(relative, expectedSha, expectedBytes) {
    if (typeof relative !== "string" || !relative.startsWith(PREFIX))
      throw new Error("Original source is outside the retained DMR directory");
    const target = await realpath(path.resolve(root, relative));
    const rel = path.relative(root, target);
    if (path.isAbsolute(rel) || rel === ".." || rel.startsWith(".." + path.sep))
      throw new Error("Original source resolves outside the selected application");
    const bytes = await readFile(target);
    const actualSha = digest(bytes);
    if (actualSha !== expectedSha || (expectedBytes !== undefined && bytes.length !== expectedBytes))
      throw new Error("Original source bytes differ: " + relative);
    return {path:relative,encoding:"utf-8",content:bytes.toString("utf8"),
            bytes:bytes.length,sha256:actualSha};
  }
  const captureFile = await original(PREFIX + "capture.json", SOURCE_CAPTURE_SHA256);
  const capture = JSON.parse(captureFile.content);
  const inputs = [captureFile];
  for (const source of capture.response_sources) {
    if (/^\d{5}$/.test(source.parameter_code || ""))
      inputs.push(await original(source.path, source.sha256, source.bytes));
  }
  const result = summarizeDmrCapture({files:inputs});
  const moduleBytes = await readFile(fileURLToPath(import.meta.url));
  const products = makeProducts(result, digest(moduleBytes), digest);
  const output = path.resolve(options["--output"] || path.join(root, PREFIX, "derived"));
  await mkdir(output, {recursive:true});
  for (const [name, content] of Object.entries(products)) {
    const target = path.join(output, name);
    try {
      await writeFile(target, content, {encoding:"utf8",flag:"wx"});
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      const existing = await readFile(target);
      if (digest(existing) !== digest(content))
        throw new Error("Choose a new output directory; the existing product differs: " + target);
    }
  }
  process.stdout.write(JSON.stringify({
    schema:result.schema,output,source_capture_sha256:result.capture_sha256,
    period_rows:result.periods.length,annual_rows:result.annual.length,
    selected_original_records:result.selections.filter(row=>row.selected).length,
    files:Object.entries(products).map(([name,content])=>
      ({name,bytes:Buffer.byteLength(content,"utf8"),sha256:digest(content)}))
  },null,2) + "\n");
}

export {summarizeDmrCapture, makeProducts};

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => {process.stderr.write(error.message + "\n"); process.exitCode = 1;});
}
