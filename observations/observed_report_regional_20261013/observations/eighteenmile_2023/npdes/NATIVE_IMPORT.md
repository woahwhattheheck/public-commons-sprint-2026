# Native DMR source and map intake

Manifest: `observations/eighteenmile_2023/npdes/model-sources.json`. The current Workspace importer registers one original-datum point layer and three tables, preserving all original response, inventory, field-schema, calculation and selection-lineage companions.

Pass the manifest as another `--context-manifest` argument to the current eight-map assessment runner. Its existing import path adds the vector to the relevant map extents and exports and keeps all three numerical sources registered.

## Stable source IDs

- `scdes-eighteenmile-npdes-outfalls-2023`: four current DES outfall points in the response's native EPSG:26917.
- `epa-eighteenmile-2023-dmr-records`: all 980 original reported rows.
- `upstate-eighteenmile-2023-dmr-period-loads-872d4183e2e5`: 230 reporting-period quantities and their original record identities.
- `upstate-eighteenmile-2023-dmr-annual-loads-ef74ad35ef48`: 20 complete-year or quantified-period summaries.

## Map interpretation

Each point retains its original state OBJECTID, permit and outfall identity, current source capture time, coordinate method and verification code. Original coordinates are copied without transformation. The state source reports Unknown collection method and verification code N; those exact fields travel with the layer.

The 2023 DMR join is by permit. The EPA external reporting feature remains a separate property: Milliken uses T1M for phosphorus/nitrate/TSS/flow and T1Q for ammonia, while its state map feature is outfall 001. The retained source JSON preserves all original field definitions and values.

Phosphorus, suspended solids and flow cover all 365 days for all four permits. Both Pickens total-nitrogen annual values are null, while their February-December quantified totals and 334 days remain visible. Milliken nitrate appears in its own species field. Milliken ammonia has a numeric-zero September-November period, 91 quantified days, and an incomplete annual value.

Mass properties are kg of the stated pollutant; flow is million US gallons. Exact decimal quantities, every original selected/unselected DMR identity, reporting-period convention and continuous-discharge assumption remain in the calculated CSVs, derived/summary.json and DMR_LOADS.md. Reproduce those files with the retained summarize_dmr.mjs module.

The native land-cover export maps, 2023 seasonal lake concentrations and these dated effluent quantities retain their own spatial and temporal bases. Existing map and observation consumers can compare them through their preserved source identities and actual upstream geometry.

All 35 files from the completed source-and-calculation edition remain byte-identical. map-layer-capture.json records the original coordinate and annual-table inputs to this map companion.
