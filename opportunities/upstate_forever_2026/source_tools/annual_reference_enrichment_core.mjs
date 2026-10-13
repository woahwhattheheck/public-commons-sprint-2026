// Join retained regional annual targets to the original USGS national inventory.
// The existing source_tools.usgs_annual importer owns archive parsing and estimator selection.
export function enrichAnnualReferences(regionalText, inventoryText, identify) {
  const regional = JSON.parse(regionalText), inventory = JSON.parse(inventoryText);
  const fail = message => { throw new Error("annual station context: " + message); };
  const finite = value => typeof value === "number" && Number.isFinite(value);
  const hash = value => typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
  const clone = value => JSON.parse(JSON.stringify(value));
  if (regional.schema !== "upstate.annual-reference-yield-interpretation/v1" ||
      !Array.isArray(regional.rows) || !regional.rows.length)
    fail("retain the completed regional annual-reference yield output");
  if (inventory.schema !== "upstate.usgs-annual2012-inventory/v1" ||
      inventory.source?.release?.doi !== "10.5066/F7DN436B" ||
      !Array.isArray(inventory.records) || !Array.isArray(inventory.tables))
    fail("use the maintained USGS F7DN436B inventory");
  for (const name of ["load_est.zip","sitegage.zip","F7DN436B-original-metadata.xml"]) {
    const file = inventory.source.files?.[name];
    if (!file || !hash(file.sha256) || !Number.isInteger(file.bytes) || file.bytes <= 0)
      fail("retain original archive/dictionary identity: " + name);
  }
  const regionalIdentity = identify(regionalText), inventoryIdentity = identify(inventoryText);
  if (![regionalIdentity,inventoryIdentity].every(x=>hash(x.sha256)&&Number.isInteger(x.bytes)&&x.bytes>0))
    fail("both complete input bodies need byte length and SHA-256");
  const series = { "00600":"tn", "00665":"tp", "00530":"tss", "80154":"ssc" };
  const keys = new Set(), results = [];
  for (const target of regional.rows) {
    const key = JSON.stringify([target.station_id,target.comid,target.parameter_code]);
    if (keys.has(key)) fail("duplicate regional station/reach/constituent");
    keys.add(key);
    if (!series[target.parameter_code] || !/^\d+$/.test(String(target.comid)) ||
        typeof target.station_id !== "string" || !target.station_id ||
        !finite(target.annual_reference_mass) || target.annual_reference_mass < 0 ||
        !finite(target.whole_catchment_area_ha) || target.whole_catchment_area_ha <= 0)
      fail("regional target identity, constituent or whole-basin area is invalid");
    const conversion = target.annual_mass_unit === "kg/year" ? 1 :
      target.annual_mass_unit === "metric_tonnes/year" ? 1000 : null;
    if (!conversion) fail("retain the original annual mass unit");
    const candidates = inventory.records.filter(record =>
      record.station_id === target.station_id &&
      record.parameter_code === target.parameter_code &&
      String(record.comid).trim() === String(target.comid));
    const out = { regional_reference:clone(target),
      match_key:{station_id:target.station_id,comid:String(target.comid),parameter_code:target.parameter_code},
      match_status:candidates.length===1?"matched":candidates.length?"ambiguous":"not_found",
      original_national_candidates:clone(candidates) };
    results.push(out);
    if (candidates.length !== 1) continue;
    const record = candidates[0], row = record.row, code = target.parameter_code;
    if (!row || String(row.station_id??"").trim() !== target.station_id ||
        String(row.comid??"").trim() !== String(target.comid) ||
        record.series !== series[code] || !Array.isArray(record.issues) ||
        !hash(record.member?.sha256) || !Number.isInteger(record.record_number) ||
        record.record_number < 1 || !hash(record.record_id))
      fail("national source row, archive member or original record identity is invalid");
    if (record.issues.length) {
      out.match_status = "matched_with_source_issues";
      out.source_issues = [...record.issues];
      continue;
    }
    const method = String(row["flux_"+code+"_final_method"]??"").trim();
    if (!["beale","flux5pkd"].includes(method) || method !== record.final_method)
      fail("the retained original final-method field differs from the inventory");
    const loadField = (method==="beale"?"rload_a_":"LOAD_A_")+code;
    const errorField = (method==="beale"?"serload_a_":"SLOAD_A_")+code;
    if (record.selected_load_field !== loadField || record.selected_standard_error_field !== errorField ||
        record.unit !== "kg/year" || String(row[loadField]??"").trim()==="" ||
        !finite(record.value) || record.value < 0 || Number(row[loadField]) !== record.value)
      fail("the published final estimator and selected original load do not agree");
    const errorToken = String(row[errorField]??"").trim();
    const hasError = !["",".","NA","NaN","nan"].includes(errorToken);
    const error = hasError ? Number(errorToken) : null;
    if (hasError && (!finite(error) || error < 0)) fail("published standard error is invalid");
    if (record.uncertainty?.value !== error ||
        record.uncertainty?.original_field !== errorField || record.uncertainty?.unit !== "kg/year")
      fail("published standard error differs from its selected estimator field");
    const targetKg = target.annual_reference_mass*conversion;
    const deltaKg = record.value-targetKg;
    out.national_estimate = {
      record_id:record.record_id, member:clone(record.member), record_number:record.record_number,
      final_method:method,
      method:method==="beale"?"Beale Ratio Estimator":"Fluxmaster five-parameter regression with Kalman smoothing and detrending",
      original_load_field:loadField, original_load_value:row[loadField],
      annual_mass_kg:record.value, annual_mass_in_regional_unit:record.value/conversion,
      regional_unit:target.annual_mass_unit,
      standard_error:{kind:"published standard error of the selected national estimate",
        original_field:errorField,original_value:row[errorField],kg_per_year:error,
        in_regional_unit:error===null?null:error/conversion,
        percent_of_national_estimate:error===null||record.value===0?null:error/record.value*100},
      water_quality_period:{start:row["wq_start_date_"+code]??null,end:row["wq_end_date_"+code]??null},
      original_water_quality_observations:row["n_wq_obs_"+code]??null,
      original_censored_observations:row["n_wq_censored_"+code]??null,
      original_flow_period:{start_inclusive:row.dflow_start_date_predpd,end_inclusive:row.dflow_end_date_predpd},
      inventory_flow_period:{start:record.period_start,end_exclusive:record.period_end},
      original_flow_station_id:row.flow_station_id,
      original_station_drainage_area_km2:row.area,
      original_flow_station_drainage_area_km2:row.flow_station_area,
      original_merged_stations:row.merged_stations??null,
      temporal_basis:clone(record.temporal_basis),
      annual_yield_on_retained_basin_hectares:record.value/conversion/target.whole_catchment_area_ha,
      annual_yield_unit:target.yield_unit,
      standard_error_on_retained_basin_hectares:error===null?null:error/conversion/target.whole_catchment_area_ha
    };
    out.comparison = {
      regional_mass_kg:targetKg,national_mass_kg:record.value,
      national_minus_regional_kg:deltaKg,
      national_minus_regional_in_regional_unit:deltaKg/conversion,
      relative_difference_percent:targetKg===0?null:deltaKg/targetKg*100,
      exactly_equal:deltaKg===0,
      interpretation:"The national source and regional service remain separate published editions. Compare their original numeric values; the national standard error belongs to its selected national estimator."
    };
  }
  const counts = {};
  for (const row of results) counts[row.match_status]=(counts[row.match_status]||0)+1;
  return {
    schema:"upstate.annual-reference-station-context/v1",
    original_regional_input:{bytes:regionalIdentity.bytes,sha256:regionalIdentity.sha256},
    original_national_inventory:{bytes:inventoryIdentity.bytes,sha256:inventoryIdentity.sha256},
    national_source:clone(inventory.source),national_tables:clone(inventory.tables),
    matching:"Exact original station_id, constituent parameter_code and COMID; station names and aliases do not select a record.",
    national_units:"Original national loads and their standard errors are kg/year; conversion to the existing regional metric-tonne unit divides by1000 once.",
    area_definition:regional.area_definition,
    uncertainty_interpretation:"Published estimator standard errors describe the selected national load. They are not prediction intervals, measurement detection limits, model scenario uncertainty, or a transferred error estimate for a different published regional value.",
    source_period_interpretation:"Preserve regional source-global dates and each national station's original water-quality/flow dates together. The maintained importer converts the included final flow day to an exclusive end.",
    relationships:clone(regional.relationships),
    summary:{regional_targets:results.length,matching:counts},
    rows:results
  };
}

export function annualStationContextCsv(context) {
  const fields=["station_id","comid","parameter_code","match_status","regional_mass","regional_unit",
    "national_mass_kg","national_mass_in_regional_unit","national_minus_regional_kg",
    "relative_difference_percent","final_method","national_standard_error_kg",
    "national_standard_error_percent","water_quality_start","water_quality_end",
    "water_quality_observations","censored_observations","flow_start_inclusive","flow_end_inclusive",
    "flow_station_id","station_drainage_area_km2","flow_station_drainage_area_km2",
    "merged_stations","national_record_id","national_member","national_record_number"];
  const rows=context.rows.map(x=>{
    const n=x.national_estimate||{}, r=x.regional_reference;
    return {...x.match_key,match_status:x.match_status,regional_mass:r.annual_reference_mass,
      regional_unit:r.annual_mass_unit,national_mass_kg:n.annual_mass_kg,
      national_mass_in_regional_unit:n.annual_mass_in_regional_unit,
      national_minus_regional_kg:x.comparison?.national_minus_regional_kg,
      relative_difference_percent:x.comparison?.relative_difference_percent,final_method:n.final_method,
      national_standard_error_kg:n.standard_error?.kg_per_year,
      national_standard_error_percent:n.standard_error?.percent_of_national_estimate,
      water_quality_start:n.water_quality_period?.start,water_quality_end:n.water_quality_period?.end,
      water_quality_observations:n.original_water_quality_observations,censored_observations:n.original_censored_observations,
      flow_start_inclusive:n.original_flow_period?.start_inclusive,flow_end_inclusive:n.original_flow_period?.end_inclusive,
      flow_station_id:n.original_flow_station_id,station_drainage_area_km2:n.original_station_drainage_area_km2,
      flow_station_drainage_area_km2:n.original_flow_station_drainage_area_km2,
      merged_stations:n.original_merged_stations,national_record_id:n.record_id,
      national_member:n.member?.member,national_record_number:n.record_number};
  });
  const quote=v=>'"'+String(v??"").replaceAll('"','""')+'"';
  return [fields.map(quote).join(","),...rows.map(r=>fields.map(k=>quote(r[k])).join(","))].join("\n")+"\n";
}

export function annualStationContextMarkdown(context) {
  const esc=v=>String(v??"—").replaceAll("|","\\|").replaceAll("\r"," ").replaceAll("\n"," ");
  const number=v=>typeof v==="number"?v.toLocaleString("en-US",{maximumFractionDigits:6}):"—";
  const rows=context.rows.map(x=>{
    const n=x.national_estimate, r=x.regional_reference;
    return "| "+[r.station_name+" ("+r.station_id+")",r.parameter_code,x.match_status,
      n?.method,n?n.water_quality_period.start+" to "+n.water_quality_period.end:"—",
      n?n.original_water_quality_observations:"—",
      n?number(n.annual_mass_in_regional_unit)+" "+r.annual_mass_unit:"—",
      n&&n.standard_error.in_regional_unit!==null?number(n.standard_error.in_regional_unit)+" "+r.annual_mass_unit:"—",
      number(x.comparison?.national_minus_regional_in_regional_unit)].map(esc).join(" | ")+" |";
  });
  return "# Original station periods and annual-load uncertainty\n\n"+
    "This companion joins the existing regional annual-reference targets to the original USGS national release by station identifier, constituent and COMID. "+
    "The complete original selected rows, paired station records, source archive identities and alternative estimator columns remain in the JSON.\n\n"+
    "| Original station | Constituent code | Match | Selected national estimator | Original water-quality period | Observations | National annual load | National standard error | National minus regional, in regional units |\n"+
    "| --- | --- | --- | --- | --- | ---: | --- | --- | ---: |\n"+rows.join("\n")+"\n\n"+
    "The standard errors belong to the national estimates shown above. The differences column preserves any distinction from the existing regional service targets. "+
    "These errors do not describe the uncertainty of a modeled restoration response. Original source-global dates, station-specific sampling dates, included flow dates, "+
    "and the 2012 reference basis remain separate in the full data. Constituent 00600 is total nitrogen, 00665 total phosphorus, 00530 total suspended solids, and 80154 suspended sediment.\n\n"+
    "Whole-basin yield comparisons retain the existing complete NLDI polygon areas. Published gage drainage areas remain additional original fields, not substitute denominators. "+
    "The original ten overlap/containment relationships are retained; nested basin totals are dependent.\n\n"+
    "Source: [USGS data release 10.5066/F7DN436B](https://doi.org/10.5066/F7DN436B), "+
    "[Saad and others, 2019](https://doi.org/10.3133/sir20195069). The accompanying CSV preserves complete numeric values and original station dates; the JSON carries full lineage.\n";
}

