// Source-bound assessment interpretation for the maintained scientific delivery.
import { createArchiveCodec } from "./archive_codec.mjs";
import { zipReportFiles } from "./assessment_association_package.mjs";
const codec = createArchiveCodec();
const json = value => JSON.stringify(value, null, 2) + "\n";
const raw = value => typeof value === "string" ? codec.utf8Encode(value) : value;
const text = value => typeof value === "string" ? value : codec.utf8Decode(value);
const count = value => Number(value).toLocaleString("en-US");
const same = (actual, expected, label) => {
  if (actual !== expected) throw Error(label + " differs from its retained report");
};
export const REPORTS = Object.freeze({
  association: {
    directory: "results/assessment-association-review-20261013",
    result: "assessment-associations.json",
    schema: "upstate.assessment-association-report/v1",
    result_sha256: "94578ccc2ba23bd5bdd93a18eb8c0265fa896aaee97809aa71267e11139cb3ca",
    role: "WATER_QUALITY_ASSOCIATION_REPORT",
    prefix: "assessment-association-observed",
    title: "Published assessment and station watershed associations",
  },
  scope: {
    directory: "results/assessment-source-scope-review-20261013",
    result: "assessment-station-source-audit.json",
    schema: "upstate.assessment-station-source-audit/v1",
    result_sha256: "14da35a62ab5628477a8d31a767ec3956988fed568f72a3444df36357a203621",
    role: "WATER_QUALITY_SOURCE_SCOPE_REPORT",
    prefix: "assessment-source-scope-observed",
    title: "Coverage of original station and statewide assessment sources",
  },
});
export function relativeMember(name) {
  if (typeof name !== "string" || !/^[A-Za-z0-9_./-]+$/.test(name)
      || name.startsWith("/") || name.split("/").some(p => !p || p === "." || p === ".."))
    throw Error("Choose a canonical relative report member");
  return name;
}
const identity = (path, value) => {
  const body = raw(value);
  if (!(body instanceof Uint8Array)) throw Error("Report members must be original text or bytes");
  return {path: relativeMember(path), bytes: body.length, sha256: codec.sha256(body)};
};
const table = (columns, rows, widths) => ({kind: "table", columns, rows: rows.map(row => row.map(String)), widths});
const links = rows => ({kind: "links", items: rows.map(([title, path]) => ({title, path}))});
const join = values => values.length ? values.join(", ") : "None in retained programme";
const unique = values => new Set(values).size;

function retainOriginalReport(kind, files) {
  const config = REPORTS[kind];
  if (!config || !files || typeof files !== "object" || files["sources.json"] === undefined)
    throw Error("Choose the complete original report and its source manifest");
  const manifest = JSON.parse(text(files["sources.json"]));
  if (manifest.schema !== "upstate.sources/v1" || manifest.entries?.length !== 1)
    throw Error("Choose the original one-document report source edition");
  const entry = manifest.entries[0];
  if (entry.kind !== "document" || entry.role !== config.role || !entry.id || !entry.vintage || !entry.uri)
    throw Error("The selected original document has a different source role or identity");
  const descriptors = new Map();
  const retained = {};
  for (const descriptor of [entry, ...(entry.companions || [])]) {
    const path = relativeMember(descriptor.path);
    if (descriptors.has(path)) throw Error("Original report repeats a member: " + path);
    if (files[path] === undefined) throw Error("Original report member is missing: " + path);
    const actual = identity(path, files[path]);
    if (actual.bytes !== descriptor.bytes || actual.sha256 !== descriptor.sha256)
      throw Error("Original report member changed: " + path);
    descriptors.set(path, actual);
    retained[path] = files[path];
  }
  if (descriptors.has("sources.json")) throw Error("Original source manifest cannot declare itself");
  retained["sources.json"] = files["sources.json"];
  descriptors.set("sources.json", identity("sources.json", files["sources.json"]));
  if (!descriptors.has(config.result)) throw Error("Original report result is not retained");
  same(descriptors.get(config.result).sha256, config.result_sha256, "Selected report edition");
  const result = JSON.parse(text(retained[config.result]));
  if (result.schema !== config.schema) throw Error("Original result has another report schema");
  return {config, manifest, entry, retained, descriptors, result};
}

function associationSections(result, entry) {
  const s = result.summary, records = result.records, differences = result.differences;
  if (!Array.isArray(records) || !Array.isArray(differences)) throw Error("Assessment report lacks original record arrays");
  same(records.length, s.assessmentRecordCount, "Assessment record count");
  same(unique(records.map(r => r.site)), s.stationCount, "Distinct station count");
  same(differences.length, s.differing_publisher_records, "Publisher difference count");
  same(records.filter(r => r.station_publisher_huc12).length, s.station_publisher_exact_records, "Station HUC12 support");
  const changes = differences.filter(r => r.priority_relation === "different_priority_state_set");
  same(changes.length, s.differing_priority_state_records, "Priority association difference count");
  const sixRows = differences.map(r => [
    r.site, r.source_vintage, r.huc12, r.station_publisher_huc12,
    r.cause_label || r.cause_raw, r.source_page || r.original_assessment_record?.source_page || "",
  ]);
  const programmeRows = changes.map(r => [
    r.site,
    r.assessment_programme.name + " / " + r.huc12,
    join(r.assessment_programme.priority_states),
    r.station_programme.name + " / " + r.station_publisher_huc12,
    join(r.station_programme.priority_states),
  ]);
  return [
    [REPORTS.association.title, [
      "This report compares the original published watershed identifiers attached to " +
      count(s.assessmentRecordCount) + " assessment records at " + count(s.stationCount) +
      " sites in the selected " + count(s.domain_huc_count) + "-HUC programme. It retains each assessment edition's original status, site identity and source citation.",
      "Assessment-publisher HUC12, station-publisher HUC12 or HUC8, native point/polygon membership, NRCS programme designation and modelled export are separate quantities. A publisher-label comparison does not calculate geographic membership or a pollutant load.",
      table(["Published edition", "Assessment records", "Distinct sites", "Station HUC12 unavailable"],
        s.assessment_editions.map(r => [r.vintage, r.records, r.stations, r.station_huc12_unreported_records]),
        [1.7, 1.2, 1.1, 1.7]),
      "Sites can occur in both editions. The combined distinct-site count is " + count(s.stationCount) + "; edition site counts are not additive.",
    ]],
    ["Watershed labels and source support", [
      table(["Comparison", "Original assessment records"], [
        ["Same reported HUC12", s.recordComparisons.same_publisher_huc12 || 0],
        ["Station reports HUC8 only; same reported HUC8", s.recordComparisons.same_publisher_huc8 || 0],
        ["Different reported HUC12", s.recordComparisons.different_publisher_huc12 || 0],
      ], [4, 1.7]),
      count(s.station_huc12_unreported_records) + " records at " + count(s.station_huc12_unreported_stations) +
      " sites have only a station-publisher HUC8. Their station-based HUC12 programme association is unavailable. The assessment-publisher HUC12 remains available.",
      table(["Site", "Edition", "Assessment HUC12", "Station HUC12", "Cause", "Source page"], sixRows,
        [0.8, 0.85, 1.25, 1.25, 0.9, 0.6]),
      "Both publisher labels remain attached to the same source-bound assessment record. The complete record JSON and CSV retain original source IDs, hashes, page references, coordinates and CRS.",
    ]],
    ["NRCS programme association and focal watersheds", [
      table(["Association basis", "Priority records", "Priority sites", "Priority HUC12s", "Focal-watershed records"], [
        ["Assessment publisher HUC12", s.assessment_priority_records, s.assessment_priority_stations,
          s.assessment_priority_huc12s.length, s.assessment_focus_records],
        ["Station publisher exact HUC12", s.station_exact_priority_records, s.station_exact_priority_stations,
          s.station_exact_priority_huc12s.length, s.station_exact_focus_records],
      ], [1.9, 0.85, 0.8, 0.95, 1.15]),
      "These counts join the reported HUC12 to retained NRCS FY26 state-HUC rows. They count assessment records and sites, not monitoring measurements, confirmed treatment opportunities or predicted load reductions. HUC8-only station rows are omitted from the exact station-HUC12 denominator.",
      ...(programmeRows.length ? [
        table(["Site", "Assessment watershed", "Priority states", "Station watershed", "Priority states"],
          programmeRows, [0.65, 1.75, 0.8, 1.75, 0.8]),
        "For each row above, the original publisher-label choice changes its NRCS priority-state association. Review the original assessment and mapped native point before using the association for programme decisions.",
      ] : ["No retained publisher difference changes its priority-state association."]),
    ]],
    ["Assessment methods and complete original records", [
      ...result.methodology,
      links([
        ["Open the complete interactive assessment association report", entry.path],
        ["All assessment records and programme associations", "assessment-associations.csv"],
        ["Publisher differences and priority associations", "publisher-differences-and-priorities.csv"],
        ["Complete source-bound assessment report JSON", REPORTS.association.result],
      ]),
    ]],
  ];
}

function scopeSections(result, entry) {
  const s = result.summary, assessments = result.assessments, stations = result.stations;
  if (!Array.isArray(assessments) || !Array.isArray(stations)) throw Error("Source audit lacks complete original arrays");
  same(assessments.length, s.statewide_assessment_records, "Statewide assessment count");
  same(stations.length, s.native_station_count, "Native station count");
  const matched = assessments.filter(r => r.native_station_match);
  same(matched.length, s.matched_assessment_records, "Matched assessment count");
  same(unique(matched.map(r => r.site)), s.matched_native_stations, "Matched station count");
  const differenceKeys = new Set(result.differing_record_keys);
  const differences = assessments.filter(r => differenceKeys.has(r.record_key));
  same(differences.length, s.differing_publisher_huc12_records, "Whole-source difference count");
  const invalid = stations.filter(r => result.invalid_native_huc_station_ids.includes(r.station_id));
  const domainRecords = assessments.filter(r => r.assessment_publisher_in_selected_domain);
  const domainMatched = matched.filter(r => r.assessment_publisher_in_selected_domain);
  const outsideMatched = matched.filter(r => !r.assessment_publisher_in_selected_domain);
  same(domainRecords.length, s.selected_domain_assessment_records, "Selected assessment domain");
  same(domainMatched.length, s.selected_domain_native_matched_records, "Selected-domain native source matches");
  same(invalid.length, s.invalid_native_publisher_huc12_count, "Reported HUC attribute count");
  return [
    [REPORTS.scope.title, [
      "This companion reviews the complete " + count(s.native_station_count) +
      "-station Savannah publisher selection against all " + count(s.statewide_assessment_records) +
      " records in two retained statewide published assessment editions. Matching uses the original exact station identifier.",
      table(["Source inventory or association", "Count"], [
        ["Original native stations", s.native_station_count],
        ["Complete statewide assessment records", s.statewide_assessment_records],
        ["Assessment records with a matching native station", s.matched_assessment_records],
        ["Distinct native stations with matching assessment records", s.matched_native_stations],
        ["Native stations without records in these two editions", s.native_stations_without_selected_assessment_records],
        ["Statewide assessment records outside this native station selection", s.unmatched_statewide_assessment_records],
      ], [4.4, 1.3]),
      count(s.native_stations_without_selected_assessment_records) +
      " native stations have no matching record in these two selected editions. This describes source coverage; it is not a conclusion about water quality or monitoring activity.",
      table(["Published edition", "Statewide records", "Matched records", "Matched stations", "HUC12 differences"],
        s.assessment_editions.map(r => [r.source_id.includes("2024") ? "2024 published 303(d)" : "July 2026 TMDL status",
          r.records, r.native_matched_records, r.native_matched_stations, r.differing_publisher_huc12_records]),
        [1.7, 1, 1, 1, 1]),
      "A site may occur in both assessment editions. Distinct matched sites are counted once in the combined total.",
    ]],
    ["Source selection and the selected watershed programme", [
      table(["Assessment-publisher selection", "All original records", "Records matching native 705", "Distinct matching sites"], [
        ["Inside the selected 217 HUCs", domainRecords.length, domainMatched.length, unique(domainMatched.map(r => r.site))],
        ["Outside the selected 217 HUCs", assessments.length - domainRecords.length, outsideMatched.length, unique(outsideMatched.map(r => r.site))],
      ], [2.1, 1.2, 1.3, 1.1]),
      "The " + count(s.matched_assessment_records) + " native-source associations comprise " +
      count(domainMatched.length) + " records inside the assessment-publisher-selected domain and " +
      count(outsideMatched.length) + " records outside it. The fixed " + count(domainRecords.length) +
      "-record domain report also includes " + count(domainRecords.length - domainMatched.length) +
      " original records whose sites are outside this 705-station source selection. These are different source selections, so their totals answer different questions.",
      table(["Assessment publisher HUC12 in selected domain", "Station publisher HUC12 in selected domain", "Matched records"],
        Object.entries(s.publisher_domain_quadrants).sort().map(([key, value]) => {
          const [a, n] = key.split("/"); return [a === "inside" ? "Yes" : "No", n === "inside" ? "Yes" : "No", value];
        }), [2.3, 2.3, 1.1]),
      "The separate published 217-HUC comparison retains " + count(s.selected_domain_assessment_records) +
      " assessment-publisher-selected records using its native 159 identity cohort, including the retained WQP point sources. This whole-source audit uses only the original 705-station publisher selection; " +
      count(s.selected_domain_native_matched_records) + " of those domain-selected assessment records match that source.",
      "The July 2026 SV-192 record illustrates the selection boundary: its assessment-publisher HUC12 is 030601030613, outside the selected 217; its native station publisher reports 030601030513, inside. The original record remains in the complete statewide source, while the fixed 192-record assessment-domain report keeps its original denominator.",
    ]],
    ["Original publisher watershed differences", [
      table(["Site", "Edition", "Assessment HUC12", "Station HUC12", "Source page"],
        differences.map(r => [r.site, r.source_vintage, r.assessment_publisher_huc12,
          r.native_station_match.publisher_huc12, r.original_assessment.source_page || ""]),
        [0.85, 0.95, 1.45, 1.45, 0.75]),
      "These eight original identifier differences include the six in the fixed 192-record report plus SV-192 and the 2024 SV-686 record. Both SV-686 publisher HUC12 values are outside the selected 217 domain. The full source preserves each publisher's county, description and evidence identity.",
      "These comparisons use published labels. The maintained Station geography workflow uses the retained original coordinates and watershed polygons for point membership.",
    ]],
    ["Native reported attributes and original source detail", [
      table(["Station", "Original publisher HUC attribute", "Reported-level status"],
        invalid.map(r => [r.station_id, r.publisher_huc_raw, r.publisher_huc_status]),
        [1, 2.4, 2.1]),
      "The two eleven-digit HUC attributes above remain verbatim. They are not padded, repaired or used as invented HUC12 assignments; original station geometry and CRS remain available.",
      ...result.interpretation,
      links([
        ["Open the complete interactive source-scope report", entry.path],
        ["All statewide assessment source associations", "all-statewide-assessment-source-associations.csv"],
        ["All native station source coverage", "all-native-station-source-coverage.csv"],
        ["Original publisher HUC differences", "publisher-huc-differences.csv"],
        ["Complete source-bound audit JSON", REPORTS.scope.result],
      ]),
    ]],
  ];
}

export function composeAssessmentObservedReport(kind, files) {
  const source = retainOriginalReport(kind, files);
  const {config, result, entry, descriptors, retained} = source;
  const reportIdentity = descriptors.get(config.result);
  const sourceId = config.prefix + "-" + reportIdentity.sha256.slice(0, 20);
  const recipe = {
    schema: "upstate.observed-report/v1",
    title: config.title,
    edition: "assessment-source-interpretation-20261013-v1",
    vintage: entry.vintage,
    interpretation_kind: "published_assessment_and_source_association",
    original_report: {source_id: entry.id, ...reportIdentity},
    inputs: [...descriptors.values()],
    sections: kind === "association" ? associationSections(result, entry) : scopeSections(result, entry),
    source_links: ["sources.json", entry.path, config.result],
  };
  for (const [heading, blocks] of recipe.sections) {
    if (!heading) throw Error("Report section needs a heading");
    for (const block of blocks) {
      if (typeof block === "string") continue;
      if (block.kind === "table" && (block.columns.length !== block.widths.length ||
          block.rows.some(row => row.length !== block.columns.length))) throw Error("Report table columns differ");
      if (block.kind === "links" && block.items.some(item => !descriptors.has(item.path)))
        throw Error("Report link is outside the retained original source");
    }
  }
  const recipeBody = json(recipe), descriptor = identity("observed-report.json", recipeBody);
  const observedEntry = {
    id: sourceId, title: config.title, kind: "document", role: "OBSERVED_CONTEXT",
    vintage: entry.vintage, uri: entry.uri, ...descriptor,
    description: "Source-bound published assessment interpretation for the existing ordered scientific report.",
    companions: [...descriptors.values()],
    metadata: {related_source_ids: [entry.id], source_relationships: [
      {id: entry.id, relationship: "complete_original_assessment_report"},
    ], interpretation_kind: recipe.interpretation_kind},
  };
  const manifest = {
    schema: "upstate.sources/v1", title: config.title + " — original report and scientific delivery",
    entries: [entry, observedEntry],
  };
  const postimages = {"observed-report.json": recipeBody, "observed-sources.json": json(manifest)};
  return {sourceId, recipe, manifest, originalFiles: retained, postimages};
}

export function composeAssessmentObservedReports({associationFiles, scopeFiles}) {
  const reports = {
    association: composeAssessmentObservedReport("association", associationFiles),
    scope: composeAssessmentObservedReport("scope", scopeFiles),
  };
  const files = {}, archiveFiles = {}, entries = [];
  for (const [kind, report] of Object.entries(reports)) {
    const directory = REPORTS[kind].directory;
    for (const [name, body] of Object.entries(report.postimages)) files[directory + "/" + name] = body;
    for (const [name, body] of Object.entries({...report.originalFiles, ...report.postimages}))
      archiveFiles[directory + "/" + name] = body;
    for (const original of report.manifest.entries) {
      const entry = JSON.parse(JSON.stringify(original));
      entry.path = directory + "/" + entry.path;
      entry.companions = (entry.companions || []).map(row => ({...row, path: directory + "/" + row.path}));
      if (entry.portable_report?.path) entry.portable_report.path = directory + "/" + entry.portable_report.path;
      entries.push(entry);
    }
  }
  const manifest = {schema: "upstate.sources/v1", title: "Published assessment interpretation — complete original report sources", entries};
  archiveFiles["sources.json"] = json(manifest);
  const archive = zipReportFiles(archiveFiles, {compress: true});
  const archivePath = "results/assessment-observed-delivery-20261013/assessment-observed-reports.zip";
  files[archivePath] = archive;
  const inventory = {
    schema: "commons.artifacts/v1",
    title: "Published assessment scientific report source editions",
    recipes: Object.fromEntries(Object.entries(reports).map(([key, value]) => [key, value.sourceId])),
    archive: {...identity(archivePath, archive), manifest_member: "sources.json", source_entries: entries.length},
    original_members: Object.entries(archiveFiles).map(([path, body]) => identity(path, body)),
    generated_files: Object.entries(files).filter(([path]) => path !== archivePath).map(([path, body]) => identity(path, body)),
  };
  files["results/assessment-observed-delivery-20261013/artifacts.json"] = json(inventory);
  return {reports, files, archive, manifest, inventory};
}
