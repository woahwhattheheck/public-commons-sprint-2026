// Source-bound programme reporting for the original assessment/station editions.
import { createArchiveCodec } from "./archive_codec.mjs";
import { joinAssessmentIdentities } from "./station_assessment_identity.mjs";
import { renderAssociationReviewer } from "./assessment_association_reviewer.mjs";
import { renderNativeAssessmentReviewer, annualReferenceInterpretation, annualReferenceCsv } from "./native_assessment_reviewer.mjs";
import { bindNativeMicrobiology, renderNativeMicrobiology } from "./native_assessment_microbiology.mjs";
import { NATIVE_CONTEXT_SCHEMA, bindNativeAssessmentGeography } from "./native_assessment_geography.mjs";

export const REPORT_SCHEMA = "upstate.assessment-association-report/v1";
const codec = createArchiveCodec();
const fail = message => { throw new Error("assessment report: " + message); };
const json = value => JSON.stringify(value, null, 2) + "\n";
const unique = values => [...new Set(values)].sort();
const key = row => JSON.stringify([row.source_id, row.id]);
const esc = value => String(value ?? "").replace(/[&<>"']/g, c => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;", "'":"&#39;" }[c]));
const sha = text => codec.sha256(codec.utf8Encode(text));
const identity = (path, text) => ({ path, bytes: codec.utf8Encode(text).length, sha256: sha(text) });
const link = (uri, label) => /^https?:\/\//i.test(String(uri || "")) ?
  '<a href="' + esc(uri) + '" rel="noopener noreferrer">' + esc(label || uri) + '</a>' : esc(label || uri);
function csv(rows, columns) {
  const cell = value => {
    if (Array.isArray(value) || (value && typeof value === "object")) value = JSON.stringify(value);
    value = String(value ?? "");
    const trimmed = value.replace(/^[ \t\r\n]+/, "");
    if (/^[=+@]/.test(trimmed) || (trimmed.startsWith("-") && !/^-(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/.test(trimmed)) || /^[\t\r\n]/.test(value)) value = "'" + value;
    return '"' + value.replaceAll('"', '""') + '"';
  };
  return columns.map(cell).join(",") + "\r\n" +
    rows.map(row => columns.map(name => cell(row[name])).join(",")).join("\r\n") + "\r\n";
}
function table(headers, rows) {
  return '<div class="table"><table><thead><tr>' + headers.map(h => "<th>" + esc(h) + "</th>").join("") +
    "</tr></thead><tbody>" + rows.map(row => "<tr>" + row.map(v => "<td>" + v + "</td>").join("") + "</tr>").join("") +
    "</tbody></table></div>";
}
function counts(rows, name) {
  return Object.fromEntries(unique(rows.map(row => row[name])).map(value => [value, rows.filter(row => row[name] === value).length]));
}
function parse(text, label) {
  if (typeof text !== "string") fail(label + " must be retained UTF-8 source text");
  try { return JSON.parse(text.replace(/^\uFEFF/, "")); }
  catch { fail(label + " is not complete JSON"); }
}
function nativeGeography(text, records) {
  if (text === undefined) return null;
  const source = parse(text, "saved station geography");
  if (source.schema === NATIVE_CONTEXT_SCHEMA) return bindNativeAssessmentGeography(text, records);
  if (!Array.isArray(source.stations) || !Array.isArray(source.sources) || !source.build_id)
    fail("choose the retained station-geography analysis.json");
  const bySite = new Map();
  for (const row of source.stations) {
    if (typeof row.station_id !== "string" || bySite.has(row.station_id))
      fail("saved geography has missing or duplicate station IDs");
    bySite.set(row.station_id, row);
  }
  const result = {};
  for (const row of records) {
    if (result[row.site]) continue;
    const station = bySite.get(row.site);
    if (!station) { result[row.site] = { status: "station_absent", huc12s: [] }; continue; }
    const reference = station.selected_source_ref;
    const originalIdentityMatches = Boolean(reference &&
      reference.source_sha256 === row.native_location_source_sha256 &&
      String(reference.native_feature_id) === row.native_location_id);
    const memberships = (station.watersheds || []).filter(item => /^\d{12}$/.test(String(item.watershed_id ?? "")));
    result[row.site] = {
      status: !reference ? "location_unresolved" : !originalIdentityMatches ? "different_selected_location_source" :
        station.watershed_status || "membership_status_missing",
      selected_location_matches_identity_crosswalk: originalIdentityMatches,
      selected_source_ref: reference || null,
      huc12s: originalIdentityMatches ? unique(memberships.map(item => String(item.watershed_id))) : [],
      retained_memberships: memberships,
      watershed_status: station.watershed_status,
      build_id: source.build_id
    };
  }
  return { source: { build_id: source.build_id, title: source.title, schema: source.schema,
      sha256: sha(text), bytes: codec.utf8Encode(text).length }, stations: result };
}

export function buildAssociationReport({ assessments, identityCrosswalk, priorities, geography, nativeAnnualContext, nativeMicrobialContext, nativeMicrobialObservations }) {
  const joined = joinAssessmentIdentities(assessments, identityCrosswalk);
  const programme = parse(priorities, "original programme crosswalk");
  if (programme.schema !== "upstate.source-priority-assessment-crosswalk/v2" ||
      !Array.isArray(programme.domain_huc12s) || !Array.isArray(programme.records) ||
      !Array.isArray(programme.watersheds)) fail("choose the complete original source-priority assessment crosswalk v2");
  const domains = new Set(programme.domain_huc12s);
  if (domains.size !== programme.domain_huc12s.length ||
      [...domains].some(huc => !/^\d{12}$/.test(huc))) fail("programme domain identifiers are invalid");
  const byHuc = new Map();
  for (const row of programme.watersheds) {
    if (!domains.has(row.huc12) || byHuc.has(row.huc12) || !Array.isArray(row.nrcs_state_rows))
      fail("programme watershed rows do not match its declared domain");
    if (row.nrcs_state_rows.some(state => state.huc12_code !== row.huc12))
      fail("NRCS original state-HUC identity differs");
    byHuc.set(row.huc12, row);
  }
  if (byHuc.size !== domains.size) fail("programme omits a selected watershed");
  const originalRecords = new Map();
  for (const row of programme.records) {
    if (originalRecords.has(key(row))) fail("programme repeats a source-bound assessment ID");
    originalRecords.set(key(row), row);
  }
  if (originalRecords.size !== joined.records.length) fail("programme and native identity input cohorts differ");
  for (const row of joined.records) {
    const original = originalRecords.get(key(row));
    if (!original || Object.keys(original).filter(name => Object.prototype.hasOwnProperty.call(row, name)).some(name => String(original[name] ?? "") !== String(row[name] ?? "")))
      fail("programme record does not retain the same assessment source: " + row.source_id + "/" + row.id);
  }
  const nrcs = huc => {
    const row = byHuc.get(huc);
    if (!row) return { huc12: huc || null, domain_status: huc ? "outside_selected_domain" : "huc12_not_reported",
      name: "", priority_states: [], state_rows: [], priority_state_rows: [] };
    const priority = row.nrcs_state_rows.filter(state => state.fy26_status === "High Priority Area");
    return { huc12: huc, domain_status: "selected_domain", name: row.name,
      priority_states: unique(priority.map(state => state.st_usps)),
      state_rows: row.nrcs_state_rows, priority_state_rows: priority, focus: row.focus || null };
  };
  const mapped = nativeGeography(geography, joined.records);
  const nativeAnnual = nativeAnnualContext ? parse(nativeAnnualContext, "completed annual-reference context") : null;
  if (nativeAnnual && (mapped?.source?.schema !== NATIVE_CONTEXT_SCHEMA ||
      nativeAnnual.schema !== "upstate.annual-reference-assessment-context/v1" ||
      nativeAnnual.input_sha256 !== mapped.source.input_sha256))
    fail("the annual-reference context must match the completed native geography");
  if ((nativeMicrobialContext === undefined) !== (nativeMicrobialObservations === undefined))
    fail("retain both the microbial context and complete original observation CSV");
  const microbial = nativeMicrobialContext === undefined ? null :
    bindNativeMicrobiology(nativeMicrobialContext, nativeMicrobialObservations, parse(geography,"completed native geography"));
  const records = joined.records.map(row => {
    const assessment = nrcs(row.huc12), station = nrcs(row.station_publisher_huc12);
    const exact = Boolean(row.station_publisher_huc12);
    return { ...row, original_assessment_record: originalRecords.get(key(row)), assessment_programme: assessment, station_programme: station,
      station_huc8_domain_huc12s: exact || !row.station_publisher_huc8 ? [] :
        [...domains].filter(huc => huc.startsWith(row.station_publisher_huc8)).sort(),
      priority_relation: !exact ? "station_huc12_not_reported" :
        station.domain_status !== "selected_domain" ? "station_huc12_outside_selected_domain" :
        JSON.stringify(assessment.priority_states) === JSON.stringify(station.priority_states) ?
          "same_priority_state_set" : "different_priority_state_set",
      geographic_membership: mapped?.stations[row.site] || null };
  });
  const differences = records.filter(row => row.publisher_huc_comparison.startsWith("different_"));
  const coarser = records.filter(row => !row.station_publisher_huc12);
  const editions = unique(records.map(row => JSON.stringify([row.source_id, row.source_sha256]))).map(id => {
    const selected = records.filter(row => JSON.stringify([row.source_id, row.source_sha256]) === id);
    return { source_id: selected[0].source_id, source_sha256: selected[0].source_sha256,
      vintage: selected[0].source_vintage, records: selected.length, stations: unique(selected.map(r => r.site)).length,
      comparison_counts: counts(selected, "publisher_huc_comparison"),
      assessment_priority_records: selected.filter(r => r.assessment_programme.priority_states.length).length,
      assessment_priority_stations: unique(selected.filter(r => r.assessment_programme.priority_states.length).map(r => r.site)).length,
      station_exact_priority_records: selected.filter(r => r.station_programme.priority_states.length).length,
      station_exact_priority_stations: unique(selected.filter(r => r.station_programme.priority_states.length).map(r => r.site)).length,
      station_huc12_unreported_records: selected.filter(r => !r.station_publisher_huc12).length };
  });
  const watershedRows = [...domains].sort().map(huc => {
    const assessmentRows = records.filter(row => row.huc12 === huc);
    const stationRows = records.filter(row => row.station_publisher_huc12 === huc);
    const rowKeys = list => list.map(row => ({ source_id: row.source_id, id: row.id, site: row.site }));
    return { ...nrcs(huc), assessment_records: assessmentRows.length,
      assessment_stations: unique(assessmentRows.map(row => row.site)).length,
      station_exact_records: stationRows.length, station_exact_stations: unique(stationRows.map(row => row.site)).length,
      assessment_record_ids: rowKeys(assessmentRows), station_record_ids: rowKeys(stationRows) };
  });
  const summary = { ...joined.summary,
    domain_huc_count: domains.size,
    station_publisher_exact_records: records.filter(row => row.station_publisher_huc12).length,
    station_publisher_exact_stations: unique(records.filter(row => row.station_publisher_huc12).map(row => row.site)).length,
    assessment_publisher_huc12_count: unique(records.map(row => row.huc12)).length,
    station_publisher_exact_huc12_count: unique(records.map(row => row.station_publisher_huc12).filter(Boolean)).length,
    station_huc12_unreported_records: coarser.length,
    station_huc12_unreported_stations: unique(coarser.map(row => row.site)).length,
    differing_publisher_records: differences.length,
    differing_publisher_stations: unique(differences.map(row => row.site)).length,
    differing_priority_state_records: records.filter(row => row.priority_relation === "different_priority_state_set").length,
    assessment_priority_records: records.filter(row => row.assessment_programme.priority_states.length).length,
    assessment_priority_stations: unique(records.filter(row => row.assessment_programme.priority_states.length).map(row => row.site)).length,
    assessment_priority_huc12s: unique(records.filter(row => row.assessment_programme.priority_states.length).map(row => row.huc12)),
    station_exact_priority_records: records.filter(row => row.station_programme.priority_states.length).length,
    station_exact_priority_stations: unique(records.filter(row => row.station_programme.priority_states.length).map(row => row.site)).length,
    station_exact_priority_huc12s: unique(records.filter(row => row.station_programme.priority_states.length).map(row => row.station_publisher_huc12)),
    assessment_focus_records: records.filter(row => row.assessment_programme.focus).length,
    station_exact_focus_records: records.filter(row => row.station_programme.focus).length,
    assessment_editions: editions, native_geography: mapped?.source || null,
    ...(nativeAnnual ? {native_annual_reference:identity("inputs/annual-reference-assessment-summary.json", nativeAnnualContext)} : {}) };
  const result = { schema: REPORT_SCHEMA, report_vintage: "2026-10-13", title: mapped?.source?.schema === NATIVE_CONTEXT_SCHEMA ?
      "Upper Savannah published assessments and native watershed membership" :
      "Upper Savannah assessment and station source associations",
    summary, methodology: [
      "Assessment membership uses each retained assessment edition's published HUC12.",
      "Station membership uses only the native station publisher's reported HUC level; HUC8-only rows remain unresolved at HUC12.",
      "The exact source-bound assessment ID and native station identity crosswalk join every record. Original coordinates and CRS remain untransformed.",
      "NRCS FY26 priority context follows the original state-HUC rows for each reported HUC12; it does not score or reassign an assessment record.",
      mapped?.source?.schema === NATIVE_CONTEXT_SCHEMA ?
        "Mapped membership is read from the completed native assessment context and verified against every original station coordinate and assessment identity; publisher assignments remain unchanged." :
        "Optional mapped membership is read from the saved native station-geography analysis and uses its original point source and polygon references.",
      "Counts distinguish original assessment records, distinct sites and HUCs. The same site can occur in multiple assessment editions.",
      "A difference between publisher labels is a source distinction; choosing a source label does not change the original assessment.",
      "NRCS priority, published assessment status, mapped point membership, classified reaches and modelled export retain their separate meanings."
    ], programme_source_reference: programme.source_reference, assessment_sources: programme.assessment_sources,
    records, differences, coarser_station_memberships: coarser, watershed_comparison: watershedRows };
  if (microbial) result.microbial_source_context = microbial.source;
  const files = { ...joined.files,
    "inputs/assessment-records-domain217.csv": assessments,
    "inputs/assessment159-native-identity-crosswalk.csv": identityCrosswalk,
    "inputs/source-priority-assessment-domain217.json": priorities,
    ...(geography !== undefined ? {
      [mapped?.source?.schema === NATIVE_CONTEXT_SCHEMA ? "inputs/assessment-native-huc-context.json" :
        "inputs/station-geography-analysis.json"]: geography } : {}) };
  if (microbial) {
    files["inputs/microbial-assessment-overlap.json"] = nativeMicrobialContext;
    files["inputs/microbial-assessment-observations.csv"] = nativeMicrobialObservations;
  }
  result.inputs = Object.entries(files).filter(([path]) => path.startsWith("inputs/")).map(([path,text]) => identity(path,text));
  files["assessment-associations.json"] = json(result);
  const flattened = records.map(row => ({ ...row,
    assessment_watershed_name: row.assessment_programme.name,
    assessment_priority_states: row.assessment_programme.priority_states,
    station_watershed_name: row.station_programme.name,
    station_priority_states: row.station_programme.priority_states,
    station_domain_status: row.station_programme.domain_status,
    mapped_huc12s: row.geographic_membership?.huc12s || [],
    mapped_status: row.geographic_membership?.status || "saved_geography_not_selected",
    mapped_source_matches_crosswalk: row.geographic_membership?.selected_location_matches_identity_crosswalk ?? "",
    mapped_source_reference: row.geographic_membership?.selected_source_ref || null,
    mapped_original_memberships: row.geographic_membership?.retained_memberships || [] }));
  const added = ["assessment_watershed_name", "assessment_priority_states", "station_watershed_name",
    "station_priority_states", "station_domain_status", "priority_relation", "station_huc8_domain_huc12s",
    "mapped_huc12s", "mapped_status", "mapped_source_matches_crosswalk", "mapped_source_reference", "mapped_original_memberships"];
  const originalFields = Object.keys(joined.records[0]);
  files["assessment-associations.csv"] = csv(flattened, [...originalFields, ...added]);
  files["publisher-differences-and-priorities.csv"] = csv(flattened.filter(row => row.publisher_huc_comparison.startsWith("different_")), [...originalFields, ...added]);
  files["watershed-membership-comparison.csv"] = csv(watershedRows, ["huc12","name","priority_states","assessment_records",
    "assessment_stations","station_exact_records","station_exact_stations","assessment_record_ids","station_record_ids","state_rows"]);
  files["assessment-edition-summary.csv"] = csv(editions, Object.keys(editions[0]));
  if (nativeAnnual) {
    files["inputs/annual-reference-assessment-summary.json"] = nativeAnnualContext;
    const annualYields=annualReferenceInterpretation(nativeAnnual);
    files["annual-reference-yields.json"]=json(annualYields);
    files["annual-reference-yields.csv"]=annualReferenceCsv(annualYields);
    files["annual-reference-relations.csv"]=annualReferenceCsv(annualYields,true);
  }
  const reviewHtml = renderAssociationReviewer(result, renderAssociationReport(result));
  files["OPEN_ASSESSMENT_ASSOCIATIONS.html"] = mapped?.source?.schema === NATIVE_CONTEXT_SCHEMA ?
    renderNativeAssessmentReviewer({result,context:parse(geography,"completed native geography"),annual:nativeAnnual,html:reviewHtml}) : reviewHtml;
  if (microbial) files["OPEN_ASSESSMENT_ASSOCIATIONS.html"] = renderNativeMicrobiology({
    html:files["OPEN_ASSESSMENT_ASSOCIATIONS.html"],bound:microbial});
  const reportIdentity = identity("assessment-associations.json", files["assessment-associations.json"]);
  const sourceId = "assessment-association-report-" + reportIdentity.sha256.slice(0,20);
  files["artifacts.json"] = json({schema:"commons.artifacts/v1",source_id:sourceId,files:Object.entries(files).map(([path,text])=>identity(path,text))});
  files["sources.json"] = json({ schema: "upstate.sources/v1", title: result.title, entries: [{
    id: sourceId, title: result.title, vintage: result.report_vintage, kind: "document", role: "WATER_QUALITY_ASSOCIATION_REPORT",
    path: "OPEN_ASSESSMENT_ASSOCIATIONS.html", ...((({bytes,sha256})=>({bytes,sha256}))(identity("",files["OPEN_ASSESSMENT_ASSOCIATIONS.html"]))),
    description: "Original assessment and station publisher associations with retained NRCS state-HUC context.",
    uri: "https://github.com/woahwhattheheck/public-commons-sprint-2026/tree/main/opportunities/upstate_forever_2026",
    companions: Object.entries(files).filter(([path]) => path !== "OPEN_ASSESSMENT_ASSOCIATIONS.html")
      .map(([path,text]) => identity(path,text))
  }] });
  return { result, sourceId, files };
}

export function renderAssociationReport(result) {
  const r=result.records, s=result.summary;
  const hucCell = context => '<code>' + esc(context.huc12 || "HUC12 unreported") + '</code><br>' + esc(context.name) +
    '<br><span class="muted">' + esc(context.priority_states.length ? "FY26 priority: " + context.priority_states.join(", ") : context.domain_status === "selected_domain" ? "No FY26 priority state row" : context.domain_status.replaceAll("_"," ")) + '</span>';
  const recordLink = row => '<a href="#record-' + r.indexOf(row) + '">' + esc(row.site) + '</a>';
  const comparisons = table(["Publisher relationship","Assessment records"],Object.entries(s.recordComparisons).map(([label,count])=>[esc(label.replaceAll("_"," ")),esc(count)]));
  const differences = table(["Station / assessment edition","Assessment publisher HUC12","Station publisher HUC12","Cause / support","Priority relationship"],
    result.differences.map(row=>[recordLink(row)+"<br>"+esc(row.source_vintage),hucCell(row.assessment_programme),
      hucCell(row.station_programme),esc((row.cause_label || row.cause_raw)+" / "+row.use_support.replaceAll("_"," ")),esc(row.priority_relation.replaceAll("_"," "))]));
  const coarser = table(["Station","Assessment edition / HUC12","Station publisher HUC8","Selected HUC12s sharing that HUC8"],
    result.coarser_station_memberships.map(row=>[recordLink(row),esc(row.source_vintage)+"<br><code>"+esc(row.huc12)+"</code>",
      "<code>"+esc(row.station_publisher_huc8 || "Not reported")+"</code>",esc(row.station_huc8_domain_huc12s.join("; "))]));
  const editions = table(["Original assessment edition","Records / distinct sites","Assessment HUC: priority records / sites",
    "Station exact HUC12: priority records / sites","Station HUC12 unreported records"],s.assessment_editions.map(e=>[
    esc(e.source_id)+"<br>"+esc(e.vintage),esc(e.records+" / "+e.stations),
    esc(e.assessment_priority_records+" / "+e.assessment_priority_stations),esc(e.station_exact_priority_records+" / "+e.station_exact_priority_stations),
    esc(e.station_huc12_unreported_records)]));
  const focus = table(["Utility / watershed","Assessment publisher records / sites","Station publisher exact-HUC12 records / sites"],
    result.watershed_comparison.filter(row => row.focus).map(row => [
      esc(row.focus.utility) + "<br>" + esc(row.name) + "<br><code>" + esc(row.huc12) + "</code>",
      esc(row.assessment_records + " / " + row.assessment_stations),
      esc(row.station_exact_records + " / " + row.station_exact_stations)]));
  const groups = table(["HUC12 / original watershed name","NRCS priority states","Assessment publisher records / sites","Station publisher exact-HUC12 records / sites"],
    result.watershed_comparison.map(row=>["<code>"+esc(row.huc12)+"</code><br>"+esc(row.name),esc(row.priority_states.join(", ") || "No priority state row"),
      esc(row.assessment_records+" / "+row.assessment_stations),esc(row.station_exact_records+" / "+row.station_exact_stations)]));
  const recordDetails = r.map((row,index)=>{
    const mapped=row.geographic_membership;
    const sources=table(["Source role","Native identity / original source","Original source SHA256"],[
      ["Assessment",link(row.source_uri,row.source_id)+"<br>"+esc(row.id)+"<br>"+esc(row.source_vintage)+" · page "+esc(row.source_page),"<code>"+esc(row.source_sha256)+"</code>"],
      ["Station publisher",esc(row.native_location_source_id)+"<br>Native ID "+esc(row.native_location_id)+" · crosswalk row "+esc(row.identity_crosswalk_row),"<code>"+esc(row.native_location_source_sha256)+"</code>"]]);
    return '<details id="record-'+index+'"><summary>'+esc(row.site)+" · "+esc(row.source_vintage)+" · "+
      esc(row.cause_label || row.cause_raw)+" · "+esc(row.publisher_huc_comparison.replaceAll("_"," "))+"</summary>"+
      table(["Assessment publisher HUC12","Station publisher HUC","Original native coordinates","Saved polygon membership"],[[
        hucCell(row.assessment_programme),hucCell(row.station_programme)+(row.station_publisher_huc8?"<br>HUC8 "+esc(row.station_publisher_huc8):""),
        esc(row.native_location_crs)+"<br>"+esc(row.native_x)+", "+esc(row.native_y),
        mapped?esc(mapped.status.replaceAll("_"," "))+"<br>"+esc(mapped.huc12s.join("; ")):
          'Open the saved Station geography edition for its computed membership.']])+sources+
      "<p>Use: "+esc(row.use)+" · support: "+esc(row.use_support.replaceAll("_"," "))+" · original cause: "+
      esc(row.cause_source_cell || row.cause_raw)+" · TMDL report: "+esc(row.tmdl_report)+" · approval: "+esc(row.approval_date)+"</p>"+
      '<details><summary>Complete retained record and source relationships</summary><pre>'+esc(json(row))+"</pre></details></details>";
  }).join("");
  const downloadNames=["assessment-associations.json","assessment-associations.csv","publisher-differences-and-priorities.csv",
    "watershed-membership-comparison.csv","assessment-edition-summary.csv","inputs/source-priority-assessment-domain217.json",
    "inputs/assessment-records-domain217.csv","inputs/assessment159-native-identity-crosswalk.csv","artifacts.json"];
  return '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'+
    '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; style-src \'unsafe-inline\'; base-uri \'none\'; form-action \'none\'">'+
    "<title>"+esc(result.title)+"</title><style>body{font:15px/1.5 system-ui,sans-serif;color:#222;background:#fff;max-width:1380px;margin:32px auto;padding:0 24px}"+
    "h1,h2{line-height:1.2}h2{margin-top:2rem}a{color:inherit}nav{border-block:1px solid #bbb;padding:12px 0}nav a{margin-right:1rem}"+
    ".table{overflow:auto}table{width:100%;border-collapse:collapse;font-size:13px}td,th{border:1px solid #bbb;padding:9px;text-align:left;vertical-align:top}th{background:#eee}"+
    "code,pre{font-size:12px;overflow-wrap:anywhere}pre{white-space:pre-wrap}details{border:1px solid #bbb;padding:12px;margin:10px 0}summary{cursor:pointer;font-weight:600}"+
    ".muted{color:#555}.summary{border:1px solid #888;padding:16px}li{margin:.35rem 0}@media print{body{margin:0;max-width:none}tr{break-inside:avoid}thead{display:table-header-group}details{break-inside:avoid}}</style></head><body>"+
    "<h1>"+esc(result.title)+"</h1><p class=summary>"+esc(s.assessmentRecordCount)+" original assessment records · "+esc(s.stationCount)+
    " distinct sites · "+esc(s.domain_huc_count)+" selected watersheds · "+esc(s.differing_publisher_records)+
    " differing HUC12 records · "+esc(s.station_huc12_unreported_records)+" records with station HUC8 only.</p>"+
    '<nav><a href="#differences">Publisher differences</a><a href="#editions">Programme context</a><a href="#watersheds">All watersheds</a>'+
    '<a href="#records">Every original record</a><a href="#downloads">Files and sources</a></nav>'+
    "<h2>How to use these associations</h2><ul>"+result.methodology.map(t=>"<li>"+esc(t)+"</li>").join("")+"</ul>"+comparisons+
    '<h2 id="differences">Every differing publisher HUC12</h2><p>The two reported source assignments stay visible together. Source review can follow the exact station, assessment page and source edition in each record.</p>'+differences+
    "<h2>Station sources reporting HUC8 only</h2><p>These records compare at the eight-digit source level. The listed domain HUC12s are a lookup, and are not assigned station memberships.</p>"+coarser+
    '<h2>Four utility focus watersheds</h2>'+focus+'<h2 id="editions">NRCS programme context by original assessment edition</h2><p>Each count uses its stated source relationship. The exact-HUC12 station column omits records whose station source reports only HUC8. State-HUC priority rows retain their original programme meaning.</p>'+editions+
    '<h2 id="watersheds">Complete selected watershed comparison</h2><p>Distinct site counts are computed within each HUC and relationship. Summing these rows can repeat sites appearing in multiple original assignments.</p>'+groups+
    '<h2 id="records">Every original assessment and native station identity</h2>'+recordDetails+
    '<h2 id="downloads">Complete report and reusable sources</h2><ul>'+downloadNames.map(name=>'<li><a href="'+esc(name)+'">'+esc(name)+"</a></li>").join("")+
    "</ul><h3>Original programme and assessment source references</h3><pre>"+esc(json({programme:result.programme_source_reference,assessments:result.assessment_sources,inputs:result.inputs}))+
    "</pre></body></html>\n";
}
