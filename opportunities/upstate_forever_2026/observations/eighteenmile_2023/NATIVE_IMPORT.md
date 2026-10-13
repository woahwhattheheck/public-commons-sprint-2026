# Import the complete Eighteenmile 2023 study into the current workspace

Manifest: `observations/eighteenmile_2023/model-sources.json`. It registers two point layers and six numerical/identity tables through the existing `Workspace.import_sources` API. Every body and companion is hash-bound. Paths are relative to the manifest directory.

Use this manifest as another `--context-manifest` argument on the current eight-map assessment runner. The runner imports the registered sources and includes both context vector layers in relevant map extents and exports. Numerical tables remain ordinary registered sources for Measurements, monitoring and chemistry workflows.

## Stable vector source IDs

- `scdes-eighteenmile-study-2023-wgs84`: SV-268 and SV-374, native WGS84/EPSG:4326 coordinates.
- `scdes-eighteenmile-study-2023-nad83`: SV-838, SV-839 and SV-840, native NAD83/EPSG:4269 coordinates.

## Observation interpretation

Map properties show published surface seasonal concentrations, sample counts, sampling depth and dates. Total nitrogen is the report's total Kjeldahl nitrogen plus nitrate/nitrite. Each feature links both the original station metadata and report; full table rows preserve reported detection-limit substitutions and vertical strata.

These concentrations describe the April-October 2023 monitoring campaign. The complete DMR companion supplies independently reported point-source mass rates and their integrated reporting periods. Existing model and observation consumers can compare spatial and temporal support using each retained basis.

`chlorophyll_a_n_published` preserves Table 7 values, including 4 at SV-374 and SV-840, with the conflicting methods count in a scalar note and retained source_notes.json. `study_huc10` identifies the whole study watershed; native domain membership comes from the actual point-in-polygon join.

The ten source files that preceded this map/import edition retain their exact original bytes. `map-layer-capture.json` records the map derivation and original source file identities.
