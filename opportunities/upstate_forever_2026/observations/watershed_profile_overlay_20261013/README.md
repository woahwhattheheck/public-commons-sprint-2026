# Native watershed map overlay: land cover and observation profiles

This source joins the **217 original Upper Savannah HUC12 polygons** to the completed source-bound land-cover/observation profiles. The overlay retains **all 273,049 original vertices**, with no simplification or reprojection. Each original Esri polygon has exactly one closed ring; that ring becomes a GeoJSON Polygon with the original **EPSG:3857** declaration. The complete original 11,220,042-byte Esri FeatureSet is retained as a hashed companion.

The GeoJSON exposes the exact HUC12 string, native object ID, name, downstream HUC identifier, and every profile column. Its **29 numeric fields** carry native annual hectares, net and gross group changes, changed-cell counts/percentages, draft assessment station counts and local gauge/flow counts. Original station, gauge, outfall and cause lists remain scalar JSON strings.

## Use in the existing native application

Import `model-sources.json` from this directory into the same project Workspace. The source is an ordinary `kind: vector` entry with the declared original CRS and complete retained companions. Select its numeric attributes in the existing map/layer controls. `map-fields.json` lists seven suggested thematic field selections; it supplies field names and scientific interpretation for the maintained cartography controls.

| Map | Attribute | Units |
| --- | --- | --- |
| Developed classes, 2025 | developed_area_2025_ha | ha |
| Developed net change | developed_net_change_ha | ha |
| Forest gross loss | forest_gross_loss_ha | ha |
| Agriculture net change | agriculture_net_change_ha | ha |
| All class changes | changed_class_percent | percent |
| Draft 2026 assessment stations | draft2026_assessment_station_count | count |
| Local observed-flow gauge points | local_observed_flow_gauge_count | count |

A station count is a point-membership count, not a watershed-wide assessment. A local gauge point does not establish that its catchment covers the entire HUC. The draft assessment vintage remains explicit. Land-cover transitions compare original product classifications and do not alone identify the cause or physical timing of change. The hectare attributes use native cell centres; the existing fractional-area ledger is a separate calculation.

## Exact source and rebuild

The retained profile CSV is 115,090 bytes, SHA256 `9e999756fb01b84a4d88784dae5030e0658d5eef922e771825c5a40a6b925d62`. The original geometry is SHA256 `2300d9b32a513d70503222a5d2e782e032107297214036a58e8b444a312169af`. `overlay-binding.json` binds both inputs, the output, source methods, all fields and the exact geometry checks.

```sh
node observations/watershed_profile_overlay_20261013/rebuild.mjs --source-dir observations/watershed_profile_overlay_20261013 --output NEW_WATERSHED_PROFILES.geojson
```

The rebuild reuses the maintained profile CSV reader, checks the original input identities, rejects missing/duplicate HUCs or a changed geometry contract, joins every scalar value, and requires the complete output to match the published GeoJSON hash. This exact rebuild has been executed in the live V8 runtime; every original coordinate and scalar profile value matches.

## Receive on a host with the original project domain

The active project already retains the exact original 217-feature domain. Receive the small CSV, binding, core, rebuild script, field guide and manifest from this source directory, and use that existing original JSON or gzip directly:

```sh
node observations/watershed_profile_overlay_20261013/rebuild.mjs --source-dir observations/watershed_profile_overlay_20261013 --original-domain ACTUAL_RETAINED_ORIGINAL_DOMAIN_JSON_OR_GZIP --output observations/watershed_profile_overlay_20261013/watershed-profiles.geojson
```

The script decompresses a gzip input when present, verifies the complete original decoded SHA256, retains its exact body as the companion and generates the full GeoJSON locally. It accepts only byte-identical retained outputs on repetition. This uses the existing project geometry and the 115 KB profile table; the native host can complete the vector source even when its public network cannot download the two large repository bodies.
