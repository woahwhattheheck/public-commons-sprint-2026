# Final Lake Keowee profile in the existing Conservation workflow

This source joins the final nine-file Keowee package to the current native Conservation engine. It preserves the v8 operator, original candidate collection, plan store, optimizer and geometry-to-scenario-to-paired-experiment bridge.

## Native integration revision 1.0.1

The complete source revision parses valid CSV stream lengths before converting metres to miles, preserving the exact original scalar. Stream-class observations also require the retained source selection to cover all four published scoring classes and the native group-presence observations to be known. Wetland arrays retain the corresponding known group presences. Explicit source-profile N/P/sediment bindings now carry their observed scalar means and complete binding provenance into the typed observation bundle.

## Installed source

The new adapter is `model/keowee_profile_adapter.py`. The complete successor `model/keowee_priority.py` is based on the 34,855-byte native source in paired science F0C8Q8JF70A, SHA256 `cb7c6f9aa1d193c594b9427cb80ddedc9a209924e4347f5759a54e51151341dd`. The integration ledger contains exact old/new edits for composition with concurrent source changes.

The adapter reads the exact profile at:

`source/keowee/20261013/lake-keowee-methodology.json`

The file is 78,447 bytes, SHA256 `388f9f7ae3246dd156fad446c616bbf8d3440a09b2edd524c45cef1d6c299da0`. It is already merged in public-commons-sprint-2026 under `opportunities/upstate_forever_2026`, PR2742, merge `81302c536c6f7f4c6c664024cf95007a287244ca`. The package revision is 1.0.2; the underlying published methodology profile retains id `lake-keowee-wbp-2020`, version `1.0.0`.

`source/keowee-native-binding-20261013.json` records all 46 typed observation fields, all 35 original leaf criteria, 54 native criterion links and eight category ID mappings. It preserves the distinction between combined native metrics and original separate observations.

## Scoring behavior

The existing category caps and published priority ranges are checked against the final profile when the native method definition is loaded. The resulting method identity includes the source profile, binding and adapter identities. The catalog and ranked candidates expose those identities through their existing response objects.

Sensitive-buffer acreage, hydric-soil acreage and parcel-size criteria use the original literal interval endpoints. Overlaps return their attainable point alternatives. A value in a printed gap retains the criterion's possible points. Boolean, grouped maximum and capped-sum criteria preserve discrete alternatives throughout aggregation.

For example, printed nitrogen value 0.03246 matches both low and medium: its possible contributions are 0 and 2 points. Value 0.1280935 is in the printed gap and retains 0, 2 and 3 as possible contributions. The existing known/possible point displays continue to consume the same fields. `score_options` and `priority_options` retain the full attainable alternatives for source inspection.

Native explicit thresholds and current-study tertiles remain available as named adaptations. Literal CWA or export bins can be chosen through the existing advanced score specification:

~~~json
{
  "kind": "table",
  "field": "original_cwa_mean",
  "unit": "dimensionless_index",
  "transform": "profile_band",
  "reference": "Original retained CWA parcel mean; Lake Keowee Appendix D p138."
}
~~~

That binding belongs under `score.bindings.cwa_priority`. The table field must exist in the retained source and contain its actual scalar mean. Original provider field names remain exact.

For an actual native nitrogen baseline at a recorded 900-square-metre pixel area:

~~~json
{
  "kind": "native_export",
  "pollutant": "nitrogen_export",
  "statistic": "parcel_mean_cell_mass",
  "band_method": "source_profile",
  "pixel_area_m2": 900,
  "adaptation_reference": "Current selected 30-metre baseline grid; transfer of the published parcel-mean bins.",
  "reference": "Lake Keowee Appendix D p143 and the retained baseline run."
}
~~~

This belongs under `score.bindings.nitrogen_export_priority`. Use the actual selected pixel area. Sediment transfers also require `sediment_ton_definition: "metric_tonne"`, explicitly recording the current native interpretation of the printed unspecified ton.

## Raster units and applicability

The original published table supplies annual per-pixel means but does not establish the original pixel area. The original profile preserves that unknown. The current native adapter derives pixel area from the actual affine transform and checks projected metre units.

Current-study tertiles use the actual selected raster's pixel area, including other native resolutions. Explicit cell-mass thresholds retain their recorded `pixel_area_m2`; older explicit bindings retain their existing 900-square-metre convention. A source-profile transfer requires a recorded current pixel area and an adaptation reference.

Native N/P area rates remain kg/ha/year; native sediment rates remain metric tonnes/ha/year. Mean-cell mass is computed once from baseline mass divided by valid hectares and multiplied by actual cell hectares. Parcel totals and scenario differences do not become original current-export means. The existing paired experiment still retains its own baseline and alternative quantities.

## Typed observations and source evidence

The native table reader now keeps each original source row beside its existing metrics map. It validates the configured original ID column and retains all original evidence. Ranking attaches `point_score.original_criterion_evidence` and `point_score.profile_observations`.

The observation bundle follows `upstate.keowee-observations/v1` and can be passed directly to the final `keowee-evaluator.mjs` functions. It retains the exact parcel ID, geometry-context identity, typed values, units, original field names, actual source evidence and conversions. Its unresolved field list identifies original inputs that the current native source table does not separately contain.

Complete original stream-class coverage is checked against `source_bindings.classifications.selection.class_scope` and the native presence metrics. It uses the named provider mapping TPGT to printed TGPT and retains the raw H2OCLASS values. Observed special-class membership alone does not fill missing FW coverage. A generic selected-impairment boolean stays tied to its explicit native source scope; it does not create an unobserved bacterial relation. Combined agriculture/water adjacency stays a combined native criterion when separate stream and impoundment observations are unavailable.

Whole parcel size continues to use the original full parcel area. Reporting geometry, context masks, source editions, actual stream orders and current-study stream-length populations retain the existing native contracts.

## Existing saved studies and paired experiments

The native engine already binds its implementation and method identities at study preparation. Prepare a successor from the same retained selection to compute the new profile-bound result. Earlier saved studies and plans remain readable with their retained results.

The call sequence remains:

1. Existing `conservation.prepare` and `conservation.build`.
2. Existing `conservation.save_plan` using the exact selected original candidate IDs.
3. Existing `conservation_scenarios.create_scenario` using the saved selected footprint.
4. Existing `conservation_scenarios.prepare_experiment` and experiment execution.

The optimizer continues to consume complete original point totals, prerequisites and native output coverage. Unresolved intervals retain partial status. The source-profile join does not alter model parameters or the original scenario footprint.

## Actual source receiving journey

`source_tools/keowee_profile_receiving.py` runs one focused journey through the original Workspace and Conservation APIs. Its source is the actual county polygon from F0C8NA49K46: Greenwood OBJECTID 1, PIN `6913-674-230`, original EPSG:3361 coordinates.

The original county response is retained byte for byte with its capture record and import manifest. Its native projected polygon area is 64,970.61413215472 square feet, or 1.49152006731301 acres. The native app reprojects the original geometry to its selected EPSG:5070 analysis CRS and calculates its own area. Both calculations place the parcel below the 50-acre source threshold.

Run from the application directory on its current native environment:

~~~bash
python -B -m source_tools.keowee_profile_receiving --workspace /owned/keowee-profile-receiving
~~~

The runner imports the original source, prepares and builds the real parcel selection, checks the whole-area source criterion, saves that source selection through the current plan route, and reopens the original source, study and plan. It retains incomplete source criteria in that receiving selection. Five exact printed-interval counterexamples run in the same journey.

The result is written under the selected workspace at `receiving/keowee-native-profile-20261013.json`, together with ordinary study and plan exports. The source-area and final JavaScript evaluator journey are included as the receiving reference. The native receiver supplies its actual runtime result and artifact descriptors.

## Primary source references

- Lake Keowee Watershed-Based Plan, Appendix D pp138–147 and Appendix E pp148 onward: https://www.des.sc.gov/sites/des/files/media/document/WBP_for_Lake_Keowee_Watersheds_2020.pdf
- Original Greenwood county layer and queried polygon: https://www.greenwoodsc.gov/arcgis/rest/services/Operational_Layers/Parcels_Search_and_Select/MapServer/0
- EPSG:3361 definition, international foot factor 0.3048: https://opengeospatial.github.io/ontology-crs/data/def/crs/EPSG/0/3361/index.html
- Final profile/evaluator bank: https://tokenjunkielabs.slack.com/docs/T0BRETUB5TK/F0C8SABPBK3
- Current native scientific predecessor: https://tokenjunkielabs.slack.com/docs/T0BRETUB5TK/F0C8Q8JF70A
