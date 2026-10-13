#!/usr/bin/env node
/** Re-run the retained original Greenwood case with source-bound area intervals. */
import {readFileSync} from "node:fs";
import {createHash} from "node:crypto";
import {fileURLToPath} from "node:url";
import {resolve, dirname} from "node:path";
import {evaluateAllCriteria, aggregateCategory} from "../source/keowee/20261013/keowee-evaluator.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (path) => readFileSync(resolve(root, path));
const parse = (path) => JSON.parse(read(path).toString("utf8"));
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const sourceRoot = "source/keowee-native-receiving-20261013/";
const binding = parse("source/keowee-native-binding-20261013.json");
const manifest = parse(sourceRoot + "sources.json");
const entry = manifest.entries.find((row) => row.id === "greenwood-native-parcel-1-20261013");
const sourceBytes = read(sourceRoot + entry.path);
if (sha256(sourceBytes) !== entry.sha256) throw new Error("The original county response differs");
const profileBytes = read(binding.profile.path);
if (sha256(profileBytes) !== binding.profile.sha256) throw new Error("The original source profile differs");
const evaluatorBytes = read(binding.evaluator.path);
if (sha256(evaluatorBytes) !== binding.evaluator.sha256) throw new Error("The bound evaluator differs");
const profile = JSON.parse(profileBytes.toString("utf8"));
const original = JSON.parse(sourceBytes.toString("utf8"));
const prior = parse(sourceRoot + "source-selection-journey.json");
if (original.spatialReference.wkid !== 3361 || original.features.length !== 1) {
  throw new Error("The retained source case requires its original EPSG:3361 parcel");
}
const feature = original.features[0];
if (feature.attributes.OBJECTID !== 1 || feature.attributes.PIN !== prior.observations.parcel_id ||
    feature.geometry.rings.length !== 1) throw new Error("The original parcel identity differs");
const ring = feature.geometry.rings[0], origin = ring[0];
let doubleArea = 0;
for (let i = 0; i < ring.length - 1; i++) {
  const a = ring[i], b = ring[i + 1];
  doubleArea += (a[0] - origin[0]) * (b[1] - origin[1]) - (b[0] - origin[0]) * (a[1] - origin[1]);
}
const areaFt2 = Math.abs(doubleArea) / 2;
const areaM2 = areaFt2 * 0.3048 ** 2, acres = areaM2 / 4046.8564224;
const input = JSON.parse(JSON.stringify(prior.observations));
input.operation_id = prior.operation_id;
input.observations.parcel_area_acres.value = acres;
const interval = {
  lower: 0, upper: acres, unit: "acre", closed: true,
  method: "parcel_geometry_area_limit",
  reference: "Original county parcel OBJECTID=1, PIN=6913-674-230, EPSG:3361 ring; an in-parcel footprint intersection cannot exceed the same parcel's original planar area.",
  area_basis: "whole_original_parcel", analysis_area_acres: acres,
  observed_positive_acres: null, structural_only: true, unresolved_acres: acres,
  confirmed_absence_acres: 0, source_roles: [], coverage_complete: false, exact: false,
  source_geometry_sha256: entry.sha256, source_crs: "EPSG:3361",
  planar_area_method: "Translated shoelace area of original native ring; declared international foot to metre factor 0.3048",
  intersection_scope: "The bound applies only after the hydric or sensitive-riparian footprint is intersected with this original parcel in the same analysis geometry."
};
for (const field of ["hydric_soil_acres", "sensitive_buffer_acres"]) {
  input.observations[field] = {
    value: null, unit: "acre", interval: {...interval},
    source_entry_id: entry.id, source_uri: entry.uri, original_fields: ["geometry.rings"],
    feature_ids: ["OBJECTID=1"],
    method: "Closed geometric upper limit from original full parcel area; exact source-footprint acreage remains unresolved",
    source_sha256: entry.sha256
  };
}
const baselineCriteria = evaluateAllCriteria(profile, prior.observations);
const baselineCategories = profile.categories.map((row) =>
  aggregateCategory(profile, row.id, baselineCriteria, prior.observations));
const criteria = evaluateAllCriteria(profile, input);
const categories = profile.categories.map((row) => aggregateCategory(profile, row.id, criteria, input));
process.stdout.write(JSON.stringify({
  schema: "upstate.keowee-original-source-interval-receiving/v1",
  operation_id: prior.operation_id, edition: "closed-source-intervals-20261013",
  execution: "Original county response and bound evaluator executed by the standalone Node receiving command",
  source: {
    parcel_id: feature.attributes.PIN, object_id: feature.attributes.OBJECTID,
    source_sha256: entry.sha256, source_entry_id: entry.id, native_crs: "EPSG:3361",
    native_area_ft2: areaFt2, area_m2: areaM2, area_acres: acres,
    crs_reference: "https://opengeospatial.github.io/ontology-crs/data/def/crs/EPSG/0/3361/index.html"
  },
  original_profile_sha256: binding.profile.sha256,
  original_evaluator_sha256: binding.evaluator.original_source_sha256,
  evaluator_sha256: binding.evaluator.sha256, input, criteria, categories,
  scalar_baseline: {criteria: baselineCriteria, categories: baselineCategories},
  interpretation: "Whole original source parcel geometry bounds only in-parcel footprint intersections. Null acreage values remain null; resolved criterion points follow from every value within the closed source-native area interval."
}, null, 2) + "\n");
