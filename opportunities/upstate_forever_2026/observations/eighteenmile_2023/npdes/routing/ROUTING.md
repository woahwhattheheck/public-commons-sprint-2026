# Eighteenmile reported effluent quantities and gauge routing

This source edition joins the four original SCDES outfalls and the already retained 2023 EPA reported quantities to USGS gauge 02186702 using original NLDI hydrolocations and its original upstream flowline response.

## Actual relationships

| Permit | Facility | COMID | ReachCode | Measure | Relation to gauge |
| --- | --- | --- | --- | --- | --- |
| SC0000477 | Milliken Pendleton | 11749433 | 03060101000042 | 92.51766497413043 | Upstream, same reach |
| SC0035700 | Pendleton-Clemson | 11749433 | 03060101000042 | 24.015247259708296 | Downstream, same reach |
| SC0042994 | Pickens Upper | 11749193 | 03060101000050 | 20.82231892380323 | Upstream, original UT flowline membership |
| SC0047856 | Pickens Middle | 11749289 | 03060101000046 | 7.349855215241408 | Upstream, original UT flowline membership |

The original gauge is on COMID 11749433 / ReachCode 03060101000042 at measure 53.4049. USGS defines measure as 0 at the downstream end and 100 at the upstream end of the reach: https://pubs.usgs.gov/fs/2012/3068/FS12-3068.pdf , Figure 3 and page 2. The original gauge UT response returns 32 COMIDs within the explicit 100 km query; it includes both Pickens COMIDs.

All four actual state-projected outfall points fall inside the retained whole-catchment polygon. That polygon was requested with splitCatchment=false and includes the gauge's complete local catchment. The within-reach measure comparison resolves the Pendleton location correctly instead of treating the footprint as a gauge-specific watershed boundary. Original USGS navigation documentation explains whole-reach and catchment behavior: https://api.water.usgs.gov/docs/nldi/navigation/ .

## Quantities selected by actual network relation

The three upstream facilities report 949.31580872 kg phosphorus in the complete 2023 calendar year, 52868.11341562 kg suspended solids, and 683.717745 million US gallons of effluent. Pendleton-Clemson's downstream quantities remain separate: 170.1591991 kg phosphorus, 5494.03555368 kg suspended solids, and 456.62 million US gallons.

Upstream Pickens Upper and Middle reported total nitrogen only for February–December, 334 days each: 5148.93199689 kg combined for those quantified periods. Milliken reported nitrate as nitrogen, 4887.58235867 kg over its complete calendar year; this remains a different species. The summaries retain missing-species and incomplete-year flags. They do not combine nitrate, total nitrogen and ammonia into a single nitrogen total.

All quantities preserve the existing processor's original standard-unit average rate × actual period calendar days convention, original EPA reporting features, coverage and source IDs. The calculation assigns reported facility discharge to a network location. It applies no river attenuation or travel-time model. Native NDR outputs represent the modeled land-source pathway; receptor/chemistry operators should consume point-source quantities through their maintained explicit inputs and keep their source partition distinct.

## Geometry and dates

Two EPSG:4326 point layers are supplied: original outfalls transformed by the agency's outSR=4326 query, and the NLDI indexed flowline points. Their attributes contain the supplied point, agency point and indexed point separately.

Milliken and Upper hydrolocations used the agency-projected points directly. Middle and Pendleton hydrolocations used the original database FeatrLongitude/FeatrLatitude attributes; their provided points differ from the separate agency-projected geometries by approximately 4.71 m and 3.97 m respectively. Those differences remain explicit. NLDI snapping distances are also reported as spherical approximate distances, not surveyed reach distances. The original state layer's coordinate collection method is Unknown and its verified flag is N.

The routing and current state geometry were acquired on 2026-10-13. They spatially interpret the retained 2023 reporting inventory; the current network is not presented as a newly surveyed 2023 outfall location. The 48.6 square-mile drainage area stays the original USGS gauge metadata value, separate from the whole-catchment polygon.

## Native use and replay

Install the additive files into the same application/source root as the original 39-file DMR edition. Its files remain unchanged.

Import `observations/eighteenmile_2023/npdes/routing-model-sources.json` through the existing Workspace import_sources operation or pass it as another `--context-manifest` to the existing native assessment-map program. It registers two point layers and three tables. Scalar gauge_relation, permit_id, outfall_comid, gauge_measure, outfall_measure, and quantitative attributes are available to the existing native viewer and saved-map filters.

Replay with Node 18+:
```sh
node observations/eighteenmile_2023/npdes/routing/rebuild_routing.mjs
```

The replay verifies the actual source-file byte counts and SHA256 hashes before calculation. The same core was executed directly over the retained original bodies when producing this edition. Native source identities and physical quantities remain in the original DMR manifests; the new manifest adds routing views without changing their immutable entries.

Files:
- routing/originals/: the actual four hydrolocations, original gauge reference, whole-basin response, 32-flowline response and agency-projected outfalls.
- routing/derived/outfall_gauge_relations.csv: four original outfall-to-gauge relationships.
- routing/derived/annual_quantities_with_routing.csv: all 20 original annual/partial-period series with their relation.
- routing/derived/reported_quantities_by_gauge_relation.csv: species-specific upstream, downstream and whole-footprint summaries with complete-period and missing-species fields.
- routing/derived/outfalls_state_geometry_wgs84.geojson and outfalls_nldi_indexed_geometry.geojson: distinct display geometries and retained source coordinates.
- routing/capture.json: exact requests, retained source hashes, coordinate basis and method references.
