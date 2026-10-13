// Copyright TokenJunkieLabs. Exact source joins for retained station assessment editions.
import { createArchiveCodec } from "./archive_codec.mjs";

export const ASSESSMENT_SHA256 = "01f1a0262bb719f39d4b6c8b6e690bbf670d9aea83cbe0f532daf81b0c6a09f7";
export const CROSSWALK_SHA256 = "b5a658b16a9cb0b891426d53db78de01429f4363b83f2ff30625f9dbf932d84c";
const SCHEMA = "upstate.station-assessment-native-identity/v1";
const codec = createArchiveCodec();
const fail = message => { throw new Error("station identity: " + message); };

function csv(text) {
  if (typeof text !== "string") fail("source must be UTF-8 text");
  text = text.replace(/^\uFEFF/, "");
  const rows = []; let row = [], cell = "", quoted = false, ended = false;
  for (let index = 0; index < text.length; index++) {
    const character = text[index];
    if (quoted) {
      if (character === '"' && text[index + 1] === '"') { cell += '"'; index++; }
      else if (character === '"') { quoted = false; ended = true; }
      else cell += character;
    } else if (character === '"') {
      if (cell || ended) fail("unexpected CSV quote");
      quoted = true;
    } else if (character === "," || character === "\n" || character === "\r") {
      row.push(cell); cell = ""; ended = false;
      if (character !== ",") {
        if (character === "\r" && text[index + 1] === "\n") index++;
        rows.push(row); row = [];
      }
    } else {
      if (ended) fail("characters after a quoted CSV field");
      cell += character;
    }
  }
  if (quoted) fail("unfinished quoted CSV field");
  if (cell || ended || row.length) { row.push(cell); rows.push(row); }
  const fields = rows.shift();
  if (!fields?.length || fields.some(field => !field) || new Set(fields).size !== fields.length)
    fail("missing or duplicate CSV header");
  return { fields, rows: rows.map((values, index) => {
    if (values.length !== fields.length) fail("CSV width differs at row " + (index + 2));
    return Object.fromEntries(fields.map((field, i) => [field, values[i]]));
  }) };
}

function body(text, expected, label) {
  const data = codec.utf8Encode(text);
  const sha256 = codec.sha256(data);
  if (sha256 !== expected) fail(label + " differs from the retained original edition");
  return { bytes: data.length, sha256 };
}

function sourceKey(row) { return row.source_id + ":" + row.id; }
function sorted(values) { return [...new Set(values)].sort(); }
function counts(values) {
  const result = {};
  for (const value of values) result[value] = (result[value] || 0) + 1;
  return Object.fromEntries(Object.entries(result).sort(([a], [b]) => a.localeCompare(b)));
}
function writeCsv(fields, rows) {
  const quote = value => '"' + String(value ?? "").replaceAll('"', '""') + '"';
  return [fields.map(quote).join(","), ...rows.map(row => fields.map(field => quote(row[field])).join(","))].join("\r\n") + "\r\n";
}

export function joinAssessmentIdentities(assessmentText, crosswalkText) {
  const sourceIdentities = {
    assessments: body(assessmentText, ASSESSMENT_SHA256, "assessment source"),
    nativeCrosswalk: body(crosswalkText, CROSSWALK_SHA256, "native identity crosswalk")
  };
  const assessments = csv(assessmentText), crosswalk = csv(crosswalkText);
  for (const field of ["id", "source_id", "source_vintage", "site", "huc12", "source_sha256", "cause_code"])
    if (!assessments.fields.includes(field)) fail("assessment field missing: " + field);
  for (const field of ["site", "source_id", "native_id", "source_crs", "x", "y", "source_body_sha256",
                       "station_publisher_huc12", "station_publisher_huc8", "assessment_record_count",
                       "assessment_huc12s", "assessment_record_ids"])
    if (!crosswalk.fields.includes(field)) fail("crosswalk field missing: " + field);
  const bySite = new Map(), grouped = new Map(), recordIds = new Set();
  for (const row of crosswalk.rows) {
    if (!row.site || bySite.has(row.site)) fail("duplicate or missing native station identity");
    if (!row.native_id || !row.source_id || !/^[0-9a-f]{64}$/.test(row.source_body_sha256))
      fail("native source identity is incomplete: " + row.site);
    if (!["EPSG:26917", "EPSG:4326"].includes(row.source_crs) ||
        !row.x || !row.y || !Number.isFinite(Number(row.x)) || !Number.isFinite(Number(row.y)))
      fail("native coordinates or CRS differ: " + row.site);
    if (row.station_publisher_huc12 && !/^\d{12}$/.test(row.station_publisher_huc12))
      fail("native publisher HUC12 differs: " + row.site);
    if (row.station_publisher_huc8 && !/^\d{8}$/.test(row.station_publisher_huc8))
      fail("native publisher HUC8 differs: " + row.site);
    bySite.set(row.site, row);
  }
  for (const row of assessments.rows) {
    if (!row.site || !row.id || !row.source_id || !/^\d{12}$/.test(row.huc12))
      fail("assessment identity is incomplete");
    const key = sourceKey(row);
    if (recordIds.has(key)) fail("duplicate source-bound assessment record: " + key);
    recordIds.add(key);
    if (!bySite.has(row.site)) fail("assessment station has no retained native identity: " + row.site);
    if (!grouped.has(row.site)) grouped.set(row.site, []);
    grouped.get(row.site).push(row);
  }
  if (assessments.rows.length !== 192 || bySite.size !== 159 || grouped.size !== bySite.size)
    fail("retain the complete 192-record, 159-station original cohort");
  for (const [site, native] of bySite) {
    const selected = grouped.get(site);
    if (!selected || !/^\d+$/.test(native.assessment_record_count) ||
        selected.length !== Number(native.assessment_record_count))
      fail("crosswalk assessment count differs: " + site);
    if (sorted(selected.map(sourceKey)).join(";") !== native.assessment_record_ids.split(";").sort().join(";"))
      fail("crosswalk assessment record IDs differ: " + site);
    if (sorted(selected.map(row => row.huc12)).join(";") !== native.assessment_huc12s.split(";").sort().join(";"))
      fail("crosswalk published HUC set differs: " + site);
  }
  const addedFields = ["native_location_source_id", "native_location_source_sha256", "native_location_id",
    "native_location_crs", "native_x", "native_y", "station_publisher_huc12", "station_publisher_huc8",
    "publisher_huc_comparison", "identity_crosswalk_row"];
  if (addedFields.some(field => assessments.fields.includes(field))) fail("joined columns collide with original assessment fields");
  const nativeRows = new Map(crosswalk.rows.map((row, index) => [row.site, index + 2]));
  const records = assessments.rows.map(row => {
    const native = bySite.get(row.site);
    const comparison = native.station_publisher_huc12 ?
      (native.station_publisher_huc12 === row.huc12 ? "same_publisher_huc12" : "different_publisher_huc12") :
      native.station_publisher_huc8 ?
      (native.station_publisher_huc8 === row.huc12.slice(0, 8) ? "same_publisher_huc8" : "different_publisher_huc8") :
      "station_publisher_huc_not_reported";
    return { ...row, native_location_source_id: native.source_id,
      native_location_source_sha256: native.source_body_sha256, native_location_id: native.native_id,
      native_location_crs: native.source_crs, native_x: native.x, native_y: native.y,
      station_publisher_huc12: native.station_publisher_huc12,
      station_publisher_huc8: native.station_publisher_huc8,
      publisher_huc_comparison: comparison, identity_crosswalk_row: nativeRows.get(row.site) };
  });
  const fields = [...assessments.fields, ...addedFields];
  const differences = records.filter(row => row.publisher_huc_comparison.startsWith("different_"));
  const summary = {
    schema: SCHEMA, sourceIdentities, assessmentRecordCount: records.length, stationCount: bySite.size,
    nativeStationSources: counts(crosswalk.rows.map(row => row.source_id)),
    recordComparisons: counts(records.map(row => row.publisher_huc_comparison)),
    assessmentEditions: sorted(records.map(row => row.source_vintage)).map(vintage => {
      const selected = records.filter(row => row.source_vintage === vintage);
      return { vintage, records: selected.length, stations: new Set(selected.map(row => row.site)).size };
    }),
    differenceRecordIds: differences.map(sourceKey),
    coordinateMeaning: "Original native x/y strings and CRS from the source owner's exact identity crosswalk.",
    hucMeaning: "Published assessment HUC identifiers compared with station publisher HUC identifiers at their reported level.",
    geographicMembership: "The existing station-geography operator computes membership from original points and the retained 217-HUC polygon source.",
    sourceReferences: {
      assessments: "source/station-assessment-context/assessment-records-domain217.csv",
      nativeCrosswalk: "source_data/wqp_assessment159_additional_two_20261013/assessment159_native_identity_crosswalk.csv",
      nativeSourceManifest: "source_data/wqp_assessment159_additional_two_20261013/sources.json"
    }
  };
  return { summary, records, differences, files: {
    "assessment-native-identity.csv": writeCsv(fields, records),
    "publisher-huc-differences.csv": writeCsv(fields, differences),
    "identity-summary.json": JSON.stringify(summary, null, 2) + "\n"
  } };
}
