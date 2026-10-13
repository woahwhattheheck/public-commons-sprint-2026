// Bind completed native geometry to original assessment identities; no geometry engine.
import { createArchiveCodec } from "./archive_codec.mjs";
const codec = createArchiveCodec();
const fail = text => { throw Error("native assessment context: " + text); };
const key = row => JSON.stringify([row.source_id, row.id]);
const unique = values => [...new Set(values)].sort();
const same = (a, b, message) => { if (JSON.stringify(a) !== JSON.stringify(b)) fail(message); };
const hash = value => typeof value === "string" && /^[0-9a-f]{64}$/.test(value);
export const NATIVE_CONTEXT_SCHEMA = "upstate.assessment-native-huc-context/v1";

export function bindNativeAssessmentGeography(body, records) {
  if (typeof body !== "string") fail("retain the complete native JSON text");
  const context = JSON.parse(body);
  if (context.schema !== NATIVE_CONTEXT_SCHEMA || !Array.isArray(context.stations)
      || !context.summary || !hash(context.input_sha256) || !hash(context.domain_zip_sha256))
    fail("choose the completed native station and original polygon context");
  const expectedRecords = new Map(), bySite = new Map();
  for (const row of records) {
    if (!row.site || expectedRecords.has(key(row))) fail("original assessment identity is missing or duplicated");
    expectedRecords.set(key(row), row);
    if (!bySite.has(row.site)) bySite.set(row.site, []);
    bySite.get(row.site).push(row);
  }
  same(context.stations.length, bySite.size, "native station cohort differs from the original assessment selection");
  same(context.summary.station_count, bySite.size, "native station summary differs");
  same(context.summary.assessment_record_count, records.length, "native assessment summary differs");
  const stations = {}, seenRecords = new Set(), matchCounts = {};
  let publisherMatches = 0, publisherMissing = 0, assessmentMatches = 0, assessmentDifferences = 0;
  for (const station of context.stations) {
    const id = station.station_id, selected = bySite.get(id);
    if (!selected || stations[id]) fail("native result has an extra or duplicate station");
    const native = station.native_location;
    if (!native || !Array.isArray(native.native_coordinates) || native.native_coordinates.length !== 2
        || native.native_coordinates.some(value => !Number.isFinite(value)))
      fail("native source coordinate identity is incomplete: " + id);
    for (const row of selected) {
      same(native.source_id, row.native_location_source_id, "native station source ID differs: " + id);
      same(native.source_body_sha256, row.native_location_source_sha256, "native station source bytes differ: " + id);
      same(String(native.native_id), row.native_location_id, "native feature ID differs: " + id);
      same(native.native_crs, row.native_location_crs, "native station CRS differs: " + id);
      same(native.native_coordinates, [Number(row.native_x), Number(row.native_y)], "native coordinates differ: " + id);
      same(native.station_publisher_huc12 || "", row.station_publisher_huc12 || "", "station publisher HUC12 differs: " + id);
      same(native.station_publisher_huc8 || "", row.station_publisher_huc8 || "", "station publisher HUC8 differs: " + id);
    }
    if (!Array.isArray(station.matches) || !Array.isArray(station.geometry_huc12s)
        || !Array.isArray(station.assessment_records))
      fail("native memberships or assessment pointers are absent: " + id);
    const matches = station.matches;
    if (matches.some(row => !/^\d{12}$/.test(row.huc12) || row.covered !== true
        || !["inside", "boundary"].includes(row.membership)))
      fail("native result contains an unsupported original membership: " + id);
    const hucs = unique(matches.map(row => row.huc12));
    same(unique(station.geometry_huc12s), hucs, "native summary and retained membership rows differ: " + id);
    same(station.geometry_match_count, matches.length, "native membership count differs: " + id);
    matchCounts[String(matches.length)] = (matchCounts[String(matches.length)] || 0) + 1;
    if (native.station_publisher_huc12) {
      if (hucs.includes(native.station_publisher_huc12)) publisherMatches++;
    } else publisherMissing++;
    same(station.assessment_records.length, selected.length, "native assessment station cohort differs: " + id);
    for (const retained of station.assessment_records) {
      const identity = key(retained), original = expectedRecords.get(identity);
      if (!original || original.site !== id || seenRecords.has(identity))
        fail("native assessment pointer does not match its original station record");
      same(retained.source_sha256, original.source_sha256, "native assessment publisher bytes differ");
      same(retained.source_vintage, original.source_vintage, "native assessment vintage differs");
      same(retained.publisher_huc12, original.huc12, "native assessment publisher HUC differs");
      const expectedRelation = hucs.includes(original.huc12) ? "matches_geometry" : "differs_from_geometry";
      same(retained.geometry_relation, expectedRelation, "native assessment relation differs");
      if (expectedRelation === "matches_geometry") assessmentMatches++; else assessmentDifferences++;
      seenRecords.add(identity);
    }
    const reference = {
      source_id: native.source_id, source_sha256: native.source_body_sha256,
      native_feature_id: native.native_id, source_crs: native.native_crs,
      native_coordinates: native.native_coordinates,
    };
    stations[id] = {
      status: !matches.length ? "outside_selected_polygons" : matches.length > 1 ? "multiple_original_memberships" :
        matches[0].membership === "boundary" ? "on_original_boundary" : "inside_original_polygon",
      selected_location_matches_identity_crosswalk: true,
      selected_source_ref: reference, huc12s: hucs,
      retained_memberships: matches,
      utility_membership: station.utility_membership,
      original_assessment_memberships: station.assessment_records,
      nearest_boundary_huc12: station.nearest_boundary_huc12,
      nearest_boundary_distance_m: station.nearest_boundary_distance_m,
      coordinate_operation_accuracy_threshold_m: station.coordinate_operation_accuracy_threshold_m,
      native_context_schema: context.schema,
    };
  }
  same(seenRecords.size, records.length, "native result omits an original assessment");
  same(Object.fromEntries(Object.entries(matchCounts).sort()),
    Object.fromEntries(Object.entries(context.summary.geometry_match_counts).sort()), "native geometry summary differs");
  same(publisherMatches, context.summary.station_publisher_relations.matches_geometry || 0, "station publisher match summary differs");
  same(publisherMissing, context.summary.station_publisher_relations.no_publisher_huc12 || 0, "station HUC support summary differs");
  same(assessmentMatches, context.summary.assessment_publisher_relations.matches_geometry || 0, "assessment geometry match summary differs");
  same(assessmentDifferences, context.summary.assessment_publisher_relations.differs_from_geometry || 0, "assessment geometry difference summary differs");
  const bytes = codec.utf8Encode(body);
  return {
    source: {
      title: "Completed original station and watershed polygon context",
      schema: context.schema, bytes: bytes.length, sha256: codec.sha256(bytes),
      input_sha256: context.input_sha256, domain_zip_sha256: context.domain_zip_sha256,
      domain_member: context.domain_member, method: context.method, runtime: context.runtime,
      coordinate_operations: context.coordinate_operations, summary: context.summary,
      utility_selection: context.utility_selection,
    },
    stations,
  };
}
