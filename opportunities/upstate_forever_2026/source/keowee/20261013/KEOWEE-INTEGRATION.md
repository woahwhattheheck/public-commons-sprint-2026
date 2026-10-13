# Lake Keowee methodology source package

## Purpose

This package supplies source definitions and an executable criterion evaluator to the existing Upper Savannah conservation and scenario interface. The profile contains 35 leaf criteria, 8 published scoring categories, 46 typed observation fields, 14 reference cost items, six land-cover coefficient families, and a septic screening method. The original publication is the [2020 Lake Keowee Watershed-Based Plan](https://www.des.sc.gov/sites/des/files/media/document/WBP_for_Lake_Keowee_Watersheds_2020.pdf); page references below use the printed page numbers.

## Files and entry points

| File | Use |
| --- | --- |
| lake-keowee-methodology.json | Literal criteria, score bins, categories, source scope, septic method, costs, load coefficients and source discrepancies |
| keowee-evaluator.mjs | Dependency-free ESM functions for criterion evaluation, category aggregation, septic screening, reference costing and cover-load comparisons |
| keowee-evaluator.d.mts | TypeScript declarations for the ESM module and observation envelopes |
| keowee-fields.csv | Canonical input fields, units, domains and provider meanings |
| keowee-criteria.csv | Category-to-leaf binding, caps, input fields and printed pages |
| keowee-source-catalog.json | Original source URLs, 39 printed-page locators, 37 retrieval receipt records and exact native source bindings |
| keowee-journey-check.json | One focused implementation journey through the published rules |
| keowee-sources-manifest.json | Native `upstate.sources/v1` document entry with all package files retained as companions |

Import this directory through the existing native source importer:

```python
collection = workspace.import_sources("/absolute/path/keowee-sources-manifest.json")
primary, entry = workspace.source_file(collection["id"], "lake-keowee-wbp-2020-methodology")
```

The imported document is the calculation profile. Preserve the returned collection identifier in the existing source-selection workflow. Keep the evaluator and guide companions together with the primary JSON; the importer preserves their common-parent relative paths across backup and restore.

## Calling the evaluator

```javascript
import {
  evaluateAllCriteria, aggregateCategory, evaluateSepticScreen,
  estimateReferenceCost, compareLandcoverLoads
} from "./keowee-evaluator.mjs";

const profile = JSON.parse(await readText("lake-keowee-methodology.json"));
const input = {
  parcel_id: feature.properties.parcel_id,
  huc10: selectedHuc10,
  observations: observationsFromNativeLayers,
  choices: { protection_stream_order: "appendix_d" }
};
const leaves = evaluateAllCriteria(profile, input);
const categories = profile.categories.map(category =>
  aggregateCategory(profile, category.id, leaves, input)
);
const septic = evaluateSepticScreen(profile, input);
```

`readText`, `feature`, `selectedHuc10` and `observationsFromNativeLayers` above are the existing application's file and GIS bindings. The module itself requires no network, map framework, DOM or npm package. Evaluate the imported parcel cohort, then feed the resulting categories into the current conservation desk.

Every numerical observation carries its declared unit. For example:

```javascript
{
  nitrogen_export_mean: {
    value: nativeZonalMean,
    unit: "kg/pixel/year",
    source_collection_id: rasterCollectionId,
    source_entry_id: nitrogenOutputSourceId,
    original_fields: [retainedMeanFieldName],
    baseline_run_id: baselineRunId,
    output_layer_id: baselineNitrogenLayerId,
    grid_id: nativeGridId,
    pixel_area_m2: measuredPixelArea,
    source_units: retainedOriginalRasterUnits,
    method: "parcel mean of annual baseline export pixels"
  }
}
```

Use `keowee-fields.csv` to bind available original provider fields. Record any derived intersection, area, stream relation or zonal statistic in the observation envelope; retain the original field names and stable feature identifiers. Boolean `false` means the spatial or source inventory check was performed and found no match. Omitted values and `null` remain unresolved.

For the current parcel source, use layer `parcels_reporting` and ID field `parcel_id`. Its merged contract is Commons commit `550cff28dd7cf874b2ad1294dc6cfbdd4c2d544d`, source package `F0C8Q1B6N9Y`. The stable identifier retains county/provider/native OID; original PIN and TMS values stay strings. Use the actual imported PARCEL source identifier and collection returned by the existing importer.

## Reading results

Each leaf returns its observed inputs, source references, `score`, `possible_points`, minimum and maximum, and any unit or classification issue. A single supported score appears in `score`. Several supported scores appear in `possible_points`, with `score: null`.

A category applies its published group operators and caps and reports eligibility separately. Bundle inputs must match the same profile, parcel identifier and, when both supplied, HUC10. The raw criterion-array overload leaves the explicit parcel join with its caller. An ineligible parcel has an empty category score set. Unknown eligibility is `null`; the current interface can still display the criterion calculations while obtaining the missing eligibility input. Unresolved criteria are combined conservatively, so the possible totals can include combinations that correlated missing inputs would later eliminate. This is a useful range for completing the parcel record, not a probability distribution.

| Category | Maximum | Low | Medium | High | Printed page |
| --- | ---: | --- | --- | --- | ---: |
| Land protection | 31 | 0–9 | 10–19 | 20–31 | 47 |
| Agricultural BMPs | 17 | 0–5 | 6–11 | 12–17 | 59 |
| Wetland restoration/enhancement | 18 | 0–5 | 6–11 | 12–18 | 68 |
| Riparian buffer restoration/enhancement | 26 | 0–8 | 9–17 | 18–26 | 72, 73 |
| Voluntary dam removal | 5 | 0–0 | 2–2 | 5–5 | 80 |
| Shoreline management | 20 | 0–6 | 7–13 | 14–20 | 82 |
| Stormwater BMPs | 16 | 0–5 | 6–11 | 12–16 | 87 |
| Pet waste stations | 2 | 0–0 | — | 1–2 | 93 |

## Spatial and model binding

Create parcel observations from the actual imported polygons and the applicable source layers. The profile retains the original sensitive-buffer construction, NHD relationships, wetland and soil classes, floodplain intersection, protected-land context, and land-cover fractions. The original profile applies to HUC10 `0306010102` and `0306010103`; `evaluateAllCriteria` reports whether the supplied HUC10 matches that scope.

For another basin, save a named adaptation alongside the original profile. Record target geography, data vintage, replacement rasters, pixel resolution, units, cohort statistics, and any chosen class interpretation. The original CWA index and parcel export bins depend on the original analysis inputs. A current baseline raster can be bound explicitly to a new scenario profile with its own declared classification; retaining that derivation makes comparisons repeatable.

The source uses a parcel mean of annual export per pixel for its current-export criterion. Preserve the raster quantity and its grid. An annual parcel total and a scenario difference each need their own field. For the existing Workspace outputs, differences are alternative minus baseline; a reduction-positive display negates that difference.

The land-cover scenario payload remains the existing native form:

```javascript
{
  title: scenarioTitle,
  kind: "landcover",
  source_collection_id: importedParcelCollectionId,
  reason: scenarioReason,
  patches: [{
    mask_source_id: importedParcelSourceId,
    layer: "parcels_reporting",
    where: { parcel_id: exactStableParcelId },
    from_codes: selectedOriginalLandcoverCodes,
    to_code: replacementLandcoverCode,
    reason: patchReason
  }]
}
```

`where` is an equality object over original field names and typed scalar values. A baseline uses `patches: []`. The importer and scenario API are the exact original Workspace contract retained in `keowee-source-catalog.json`. Priority score weights belong to conservation ranking; the model's NDR/SDR configuration continues through its existing biophysical and model-profile input fields.

## Source interpretation choices

The profile preserves each published interval and the category matrices. Where a retained original GIS class is available, `nitrogen_export_class`, `phosphorus_export_class` or `sediment_export_class` can supply the original class directly. Otherwise the evaluator uses the printed numerical bins.

The discrepancy array links each source difference to its pages and implementation consequence. The most consequential cases are the protection stream-order choice, overlapping nitrogen intervals, small gaps between printed ranges, the named stream-length reference watershed, and the septic year-1970 gap. An explicit protection choice selects `appendix_d` or `table31`; when omitted, the module keeps all outcomes produced by those source interpretations.

For septic screening, the result contains distance, age and soil dimensions, including the original 500-foot sewer assumption and 300-foot water screen. The original priority mapping describes a mean-based age grouping without a numerical soil-by-age matrix. The interface can show the source dimensions and ingest the retained original GIS class when available. System condition and actual sewer service remain separate observations.

## Current SCDES class adapter

The named `scdes-h2oclass-to-keowee-2020` adapter maps the publisher's exact `H2OCLASS: "TPGT"` token to the plan's printed `TGPT` class. It returns the canonical observation together with the raw source values, original fields, identifiers and a per-value change list. The retained current source inventory contains 599 TPGT features; the profile stores its exact context and attribute-CSV source hashes.

```javascript
import { normalizeStreamClasses } from "./keowee-evaluator.mjs";

const mapped = normalizeStreamClasses(profile, {
  value: observedParcelClassCodes,
  source_collection_id: classCollectionId,
  source_entry_id: classSourceId,
  original_fields: ["H2OCLASS"],
  feature_ids: originalPublisherObjectIds
});
input.observations.stream_classes = mapped.observation;
```

Pass the complete observed parcel-intersected class list. An observed `TPGT` becomes the plan's three-point `TGPT`; `ORW`, `TN` and `FW` preserve their source spelling. Other publisher tokens remain in `mapped_values`, `unassigned_codes` and `source_class_values`, with the canonical observation unresolved until their method mapping is defined. The supplied selected-class inventory and the separate FW source retain their own coverage and geometry.

## Cost and load helpers

`estimateReferenceCost(profile, items)` multiplies validated quantities by the 2020 source catalog rates and returns itemized amounts with references. Supply the exact quantity unit from the chosen rate. This makes historical package comparison reproducible. Current vendor quotes or updated rates can be stored in a separately dated catalog.

`estimateLandcoverLoads` and `compareLandcoverLoads` accept rows containing a published land-cover class, its actual area, and `acre` or `hectare`. Each row uses the requested minimum, median or maximum source coefficient. The helper converts acres to hectares once, multiplies by the coefficient, and sums kg/year for TSS, TP and TN. Mixed land cover is area-weighted. The comparison returns alternative-minus-baseline and reduction-positive values separately, plus any area difference between the scenarios.

The coefficient helper is a direct calculation from the source table. The application should label it with its returned method and source. Native InVEST outputs retain the original model run, biophysical table, parameter profile and raster lineage.

## Verification and source retrieval

One focused executable journey checked all eight category maxima/caps, the published numerical ambiguities, required units, septic boundaries, reference cost arithmetic, hectare conversion, output sign bundle-to-parcel/HUC identity, and the current publisher class adapter. Its concise result is supplied in `keowee-journey-check.json`.

The source was retrieved through page-specific primary-site search results, including structured tables. The catalog preserves the exact original URLs and printed-page locators. The primary PDF's requested size is 26,313,762 bytes; its SHA256 and physical PDF page indexes are populated only after the original bytes are retrieved. PDF page images can then be retained as additional native source companions. All currently encoded numerical intervals, category totals and source differences remain inspectable in the profile.

## Integration ownership

This package provides the source definition and criterion-calculation arm for the existing conservation/scenario work. It complements the ES-EXP parcel-criteria integration and the current reporting-parcel source. The source bank and its native manifest give receiving agents the full code and data needed to adopt it in the current application.

## Closed source intervals and the original Greenwood receiving case

Evaluator implementation revision 1.1.0 accepts an optional `interval` on a
numeric observation consumed by a published numeric-bin rule. The profile's
original bins, category matrices and profile identity remain unchanged. Keep
`value: null` when the source establishes a range rather than an exact value:

```javascript
const observedHydricArea = {
  value: null,
  unit: "acre",
  interval: {
    lower: 0,
    upper: 1.49152006731301,
    closed: true,
    unit: "acre",
    method: "parcel_geometry_area_limit",
    reference: "Original Greenwood OBJECTID=1/PIN=6913-674-230; the footprint is intersected with that same original parcel.",
    area_basis: "whole_original_parcel",
    structural_only: true,
    source_geometry_sha256: "e4fd893f7ab655d1a9fd8e2944d9122a7786abb26d55ec85310b04ed39f49fab"
  }
};
```

This is the retained original county parcel, not an assumed landscape observation.
Its original EPSG:3361 polygon has 64,970.61413215472 square international feet,
6,035.967563544135 square metres, or 1.49152006731301 acres. The international-foot
factor is 0.3048, as declared by the
[original CRS definition](https://opengeospatial.github.io/ontology-crs/data/def/crs/EPSG/0/3361/index.html).
The upper bound applies only to a criterion footprint intersected with this same
parcel geometry. It does not describe the area of a buffer or watershed outside
the parcel, and it does not establish the presence or absence of hydric soil.

The evaluator checks finite ordered endpoints, closed bounds, the original field
domain, matching units and a nonempty method/reference. It evaluates every
published bin boundary and the intervals between boundaries. A printed gap keeps
the source's unresolved alternatives; an overlap keeps every matched class. An
exact value supplied beside an interval must fall inside it. Results retain
`value_interval`, the original interval observation,
`points_determined_by_interval` and every encountered classification state.

On the actual Greenwood parcel, both the hydric and sensitive-buffer intersection
areas are bounded by [0, 1.49152006731301] acres. All values are below the respective
5-acre and 2-acre first positive score thresholds. Each contribution is therefore
exactly zero while both exact acreages remain null. The same parcel's land-protection
possibilities narrow from 0–30 to 0–23 points. Its original protection prerequisite
retains its unresolved state. The historical scalar-only journey stays in place;
`../keowee-native-receiving-20261013/source-interval-journey.json` retains the
new complete original-case result.

The Python observation adapter forwards actual `point_score.metric_bounds` under
the corresponding profile field. It retains the actual selected field binding and
original interval, normalizes only the canonical acre spelling, and records the
in-parcel intersection scope. A bounded metric never becomes an invented exact
scalar. Boolean, stream-order, source-class and other observation semantics remain
the original evaluator's.

Run the complete original case from the application root:

```bash
node source_tools/keowee_interval_receiving.mjs
```

The command reads and verifies the existing county response, original profile and
current bound evaluator, recomputes the same original polygon area, and emits the
complete 35-criterion/eight-category JSON result. It uses existing original source
files and preserves operation `ECO13-6A4E-KEOWEE-NATIVE-PROFILE`.
