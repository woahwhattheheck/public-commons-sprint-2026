# Upper Savannah assessment geography and native map operation

This source edition puts all 87 listed monitoring sites and all 101 pollutant-specific cause rows from the 2026 draft SCDES assessment into the existing Upper Savannah scientific workspace. It retains the original 12-file assessment package and adds the complete station geography, scalar GIS attributes, original location-source responses, and an executable native map operation.

## What is included

The location set contains 67 WQP points in EPSG:4326, six WQP points in EPSG:4269, and 14 SCDES service points in EPSG:26917. All 87 station IDs match the draft listing. The last 14 source points are the original fish/biological monitoring records that did not have usable WQP location pages. Their full original service response and layer schema are included.

Each point has scalar fields for site, listed HUC12, county, description, impaired uses, listed causes, cause-specific priority text, RFP-focus membership, Eighteenmile membership, nutrient listing, original coordinate reference system and coordinate source. There is one integer flag per listed cause. Exact filters such as {"cause_tn":1}, {"listed_huc12":"030601020507"}, or {"site":"SV-268"} work with the existing native vector reader.

The four RFP focus HUC12s are 030601010703 (RS-24163), 030601010704 (RL-01020), 030601020502 (SV-790), and 030601020507 (SV-234). The current native SCDES point for SV-234 is in the NAD83 / UTM zone17N source layer, OBJECTID1966. Its full source attributes and original geometry remain available.

The assessment companions retain the draft listing, draft TMDL coverage, July28 2026 use-support snapshot, waters of concern, delistings, Hartwell priority facts, four source-field differences, original six-point intake, source catalog and model interpretation. The original companion hashes are unchanged.

## Coordinate handling

The three point files use native OGR GeoJSON with an explicit CRS member. The six EPSG:4269 points retain their original NAD83 coordinates; the 14 EPSG:26917 points retain their original projected x/y. The native review program verifies the actual Fiona/OGR CRS against the manifest before it saves a view. It uses the existing SpatialReview and pyproj transformations for the EPSG:5070 display and native watershed point queries.

The SCDES service also publishes latitude/longitude attributes. Those degree attributes are preserved inside each full original metadata record. Geometry uses the explicitly declared projected point coordinates, so there is no inferred degree-datum conversion. All 14 source records identify collection METHOD=Manual and TIER=4; these original fields are retained.

Original coordinate strings and original metadata descriptions remain separately available. The 2026 assessment description is a different field from the WQP or SCDES location description. That preserves differences between program editions without silently rewriting either source.

## Native operation

Materialize the full capsule under a working delivery directory, then use the current complete application and its populated scientific workspace:

    /opt/pyvenv/bin/python assessment/operate_assessment_maps.py --app-root /actual/current/upstate_forever_2026 --workspace /actual/populated/workspace

If the current project has no Workspace manifest yet, choose the project's shared Workspace path and add --create-workspace. This uses the original Workspace initializer and imports the actual assessment sources immediately; it preserves an existing Workspace at that path. Add --domain-manifest /actual/retained/domain/sources.json to import the retained original217-feature domain through the same source intake before its exact geometry is discovered. Repeated domain-manifest arguments retain additional original source editions. An already-imported domain can be selected from the current catalog without importing it again.

The source directory defaults to the script's own assessment directory. The program calls the original Workspace.import_sources method using geography-model-sources.json. The three primary vector entries and every retained companion become ordinary native source editions. The existing map viewer catalogs them automatically.

The operation creates eight saved review families:

- All listed monitoring sites across the current regional domain.
- One review for each of the four RFP focus HUC12s.
- Eighteenmile Creek assessment and nutrient context.
- The listed nitrogen/phosphorus sites.
- The two sites with differing source HUC labels, RS-06190 and SV-192.

It calls the maintained SpatialExports API for each saved view. The existing exporter produces its original PDF, SVG, PNG, source/provenance, overlay-feature and annotation members, together with the source/application archive and map pack. Letter paper and 220 dpi are defaults; --paper a4 and --dpi 150/220/300 select the existing alternatives. --skip-export retains the native saved views when a receiver is operating only the map workspace.

The original 217-feature Esri model domain is discovered by its decoded SHA256, 2300d9b32a513d70503222a5d2e782e032107297214036a58e8b444a312169af. Its original HUC12 field drives focus filters. Additional or successor domain layers can be supplied with repeated --domain-layer-id values from the real workspace catalog. Selected domain fields and original identities accompany every join.

The program inspects every station through the actual native point API, with zero query tolerance in the station's original CRS. For each selected watershed layer it keeps every polygon cover, original attributes, original feature identity and source SHA. The CSV preserves overlapping boundary matches and stations outside a particular retained domain. The original source geometry stays in the immutable workspace source, accessible through the native viewer; batch outputs keep its identity and attributes without duplicating the same full polygon geometry for each nearby station.

native-assessment-review/operation.json records the actual project, collection, saved-review and map-pack results. Additional source imports record the role, original manifest path, manifest SHA256 and actual source-collection ID. It is updated after each saved review and export so an interrupted worker can resume the same content-identified native operation. point-inspections.json and station-domain-joins.csv carry the operated station/domain results.

## Original study and discharge context

Supply each retained 2023 lake-study or wastewater-outfall source manifest with --context-manifest /actual/retained/context/sources.json. The operation imports the ordinary native edition and includes its vector layers automatically. Repeated context-manifest arguments combine both source editions in the same run. Existing context vector layers can also be selected by their real IDs with --context-layer-id. The program uses the existing native geometry query to include each source where it intersects a saved viewport, keeping its original attributes and provenance in the map pack. This joins the measured study and source-load work to the same assessment views.

## Combining completed model runs

The same saved views can include actual completed baseline and alternative raster layers:

    /opt/pyvenv/bin/python assessment/operate_assessment_maps.py --app-root /actual/current/upstate_forever_2026 --workspace /actual/populated/workspace --primary-layer-id ACTUAL_BASELINE_LAYER_ID --comparison-layer-id ACTUAL_ALTERNATIVE_LAYER_ID --mode difference

Layer IDs come from the maintained native catalog. The existing spatial engine checks the selected bands, grids and physical units. Its difference direction is alternative minus baseline. Workspace NDR/SDR mass rasters have already been converted from their original per-hectare outputs using the real cell area; the map operation performs no additional area multiplication.

## Reading the science

The listed HUC12 is the agency's station-context label. The native join records where the original point falls in the selected original polygons and keeps reporting/upstream fields. These source relationships support map interpretation and catchment work. Annual modeled exports are compared with relevant observed loads and periods through the existing scientific workflow.

Eighteenmile's HUC10 is 0306010106. The two component HUC12s are 030601010601 and 030601010602. The 2023 original report prints these as 03060101-06, 03060101-06-01 and 03060101-06-02. The four current listed stations in those two subwatersheds are SV-241, SV-376, SV-233 and SV-268. SV-268's TN/TP priority1 and turbidity priority3 remain separate. The full 2023 lake study has its own station, seasonal concentration, physical and monthly measurement companions.

## Original sources

- SCDES current draft 2026 Integrated Report: https://apps.des.sc.gov/PublicNotices/SearchAndDisplay/PDF/302110 . The regional listing is on physical PDF pages 67-71.
- SCDES TMDL use support, July28 2026: https://des.sc.gov/sites/des/files/Documents/BOW/WaterQuality/TMDLAttainmentStatus.pdf .
- WQP station metadata: individual original URLs are retained for all 73 sites in station_metadata_20261013.json.
- SCDES station layer: https://gis.des.sc.gov/gisserver/rest/services/water/BW_Monitoring_Stations/MapServer/9 . The complete layer metadata and exact 14-site response are included.
- Publisher route to the live station application: https://des.sc.gov/programs/bureau-water/watersheds-program/sc-watershed-atlas and https://gis.des.sc.gov/gisportal/apps/webappviewer/index.html?id=d0827cf30d3c490f9e22dd1000b8195a .
- Original 2023 Eighteenmile lake study: https://des.sc.gov/sites/des/files/Documents/BOW/WaterQuality/2023LakeProgramFinalReport.pdf .
