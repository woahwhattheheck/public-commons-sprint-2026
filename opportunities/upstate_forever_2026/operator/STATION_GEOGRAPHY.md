# Station geography — original sources, study map and portable reopening

The station geography desk joins the existing scientific workspace, authenticated operator, task queue and extension registry. It links original monitoring locations to the selected study inventory, measured observations and retained watershed polygons.

## Install in the existing application

Materialize the station contribution files under a source directory, then run:

    python SOURCE_ROOT/operator/install_station_geography.py --application APPLICATION --source-root SOURCE_ROOT

The installer copies the complete declared station, assessment, microbial and original WBD component inventory, including the current observed-station catalogue, saved assessment-report helper, native watershed figure helpers, prepared-source Scientific reports composer and complete 22-file original microbial source directory. It also installs the complete preparation, supervised native receiving and browser course declared by the assessment component, with their operating guides and original course example. The same installation includes all four original input manifests and their source families: SCDES705, the two complete normalized published assessment editions and publisher-text companion, WQP8 with the exact draft101 CSV, and WQP2. Before changing the application, it checks each selected source manifest's primary bodies and companions against the available files and declared original hashes. The dry-run receipt includes these original-source identities. It preserves prior versions and invokes the existing install_extensions.py when the application has not yet installed its extension host. Restart the existing operator to discover operator/extensions/station-geography.json. Run the model commands below from APPLICATION, the directory containing model and operator.

Runtime dependencies are the application's existing pyproj, shapely and fiona stack. The browser uses the existing local host and an SVG map. Model observations, measurement imports, chemistry and annual-load calculations keep their existing interfaces.

## Prepare, receive and operate the same complete study

The installed workflow lives in `source/observed-report-20261013/`. Use
[PREPARE_ASSESSMENT.md](../source/observed-report-20261013/PREPARE_ASSESSMENT.md)
for all three original station studies and four saved assessment selections.
Its default command uses the original inputs installed at their maintained
application-relative paths. The existing Workspace supplies the exact original
217-watershed domain; its retained source identity is checked by the study
resolver. A receiver missing that domain imports its original manifest once.
The installed report source retains native watershed figures alongside the
original assessment rows, source editions and comparison relationships.

Continue the same scientific-report operation with
[RECEIVING.md](../source/observed-report-20261013/RECEIVING.md) and, when several
original selections are already accepted,
[RECEIVING_COURSE.md](../source/observed-report-20261013/RECEIVING_COURSE.md).
The existing receiver supervises its own native worker, applies the configured
phase timeout through shutdown and the optional browser phase, and retains
the original queued tasks and output selections for resuming that operation.
The installed course example retains its author's original project and paths;
select the current operation's actual paths before using it.

[ASSESSMENT_BROWSER.md](../source/observed-report-20261013/ASSESSMENT_BROWSER.md)
continues the original page and recording through the 164-station study,
all four saved contexts, their full exports and the prepared scientific-report
selection. The receiver and course share the same scripts installed here;
no additional source packet is needed for those stages.

Use the complete application's existing scientific Python environment,
including its GIS and ReportLab dependencies, and its Node environment with
Playwright and the existing browser installation. The installer checks the
native report host files before changing source, stages the current composer
and source helpers, and retains its ordinary previous-body and concurrency
checks. It does not start another operator or duplicate the accepted receiving
operation. Restart the existing operator after source installation so its
loaded report version matches the new preparation.

After receiving, open the actual rendered screens and downloaded reports at
the presentation width and a narrow width, operate the controls, and reopen the
delivered files as a recipient would. Inspect the screenshots or recording
visually and repair observed issues before presenting the product.

## Original inputs for the 87-station study

Import the retained monitoring, WQP and watershed sources.json manifests through the original Source intake desk or the prepared-study command below. Preserve each original response and its source companions.

| Input | Original fields and selection |
| --- | --- |
| SCDES Savannah monitoring layer | Native station STAT, native feature OBJECTID, EPSG:26917. The retained response contains 705 features; 79 of the 87 study stations match this source. |
| WQP eight-station supplement | Exact station MonitoringLocationName; original feature MonitoringLocationIdentifier. Native CSV fields LongitudeMeasure and LatitudeMeasure, datum WGS84. |
| 2026 draft assessment inventory | assessment/listed_causes_2026_draft.csv contains 101 extracted site/use/cause rows at 87 distinct stations. Select as site_tables with station_id_field site. |
| Retained upstream domain | Use the actual retained 217-HUC12 polygon edition, its original source manifest and its native HUC12 field. |

Public source references:

- [SCDES original monitoring layer](https://gis.des.sc.gov/gisserver/rest/services/water/BW_Monitoring_Stations/MapServer/9).
- [Original WQP eight-station CSV](https://www.waterqualitydata.us/data/Station/search?siteid=21SC60WQ_WQX-SV-376%3B21SC60WQ_WQX-RS-24163%3B21SC60WQ_WQX-RS-21014%3B21SC60WQ_WQX-RL-21217%3B21SC60WQ_WQX-RL-24073%3B21SC60WQ_WQX-RL-21209%3B21SC60WQ_WQX-RS-22078%3B21SC60WQ_WQX-RL-21225&mimeType=csv).
- [South Carolina 2026 draft Integrated Report](https://apps.des.sc.gov/PublicNotices/SearchAndDisplay/PDF/302110), physical PDF pages 67–71 for the station listing, with the [original public notice](https://apps.des.sc.gov/PublicNotices/SearchAndDisplay/Display/38165).
- [Original national WBD HUC12 layer](https://hydro.nationalmap.gov/arcgis/rest/services/wbd/MapServer/6). The prepared study requires the retained 217-polygon domain edition derived from the original watershed selection.

The assessment table expands listed rows by cause while preserving original source-row uses, causes, priority, page and section. Those rows define station membership and retain assessment provenance. Add measured observations through observation_ids or observation_tables.

Source identities used by the prepared study:

| Retained input | SHA256 |
| --- | --- |
| Native 705-station SCDES response | 14b1a945ee8d5f172f63435b4fd955e9dada6894fcbca2964160c6e2e52d79f0 |
| Native WQP CSV, 3,640 bytes and 37 fields | 21022c3f3b46fb0bae6e341cde74880ec2e395528592f9168742f53af60b533e |
| Source-preserving WQP GeoJSON | d7322856d96cdd6898a5cef555e97529f99ec4d6dad7ab45d18f4d53f3b646e6 |
| Extracted assessment CSV, 14,033 bytes | 545a4e1413012b8f17c81c8afe815dd1e225ade5f5b9792ca22e83ef8723307f |
| Decoded native 217-HUC12 domain, 11,220,042 bytes | 2300d9b32a513d70503222a5d2e782e032107297214036a58e8b444a312169af |

Live source services can return later editions. The prepared selection resolves these exact retained input hashes; import a later edition through the generic selectors when a different study edition is intended. The fixture operator/fixtures/station_geography_actual87_ids.json preserves all 87 exact IDs and the assessment PDF provenance.

## Prepare the complete study

    python -m model.station_study --workspace WORKSPACE \
      --source-manifest MONITORING/sources.json \
      --source-manifest WQP_SUPPLEMENT/sources.json \
      --source-manifest ORIGINAL_DOMAIN/sources.json \
      --assessment-csv WQP_SUPPLEMENT/assessment_listed_causes_2026_draft_original.csv

The command reuses retained collections by original manifest identity, imports the unchanged assessment CSV as a native table, and saves the complete editable selection. It returns selection_path, operation_id, action and payload when the original inputs are ready.

Open Station geography and choose **Build this study** under **Upper Savannah assessment — 87 monitoring stations**. The prepared selection fills both point sources, the assessment inventory and the retained watershed geometry, then submits one operation through the original queue. Read operator/PREPARED_STATION_STUDY.md for the complete operating path.

## Model and queue interfaces

The model entrypoint is model.station_geography.build(workspace, selection). It returns an immutable workspace item with id, selection, summary and files.

    python -m model.station_geography --workspace WORKSPACE build selection.json
    python -m model.station_geography --workspace WORKSPACE inspect EDITION_ID --complete --verify
    python -m model.station_geography --workspace WORKSPACE receive station-geography.zip
    python -m model.station_geography --workspace WORKSPACE catalog

Every source selector uses the current workspace's collection_id and original source_id. The selection supports:

- title: edition title.
- sources: original point source selectors with station_id_field and optional native_id_field, source_crs, x_field, y_field or layer.
- site_tables: original study-inventory CSV selectors with station_id_field. Repeated assessment rows retain every source reference for their shared station.
- sites: optional exact station strings or objects with station_id, label, aliases and source_references. An explicit list filters a selected inventory.
- watersheds: retained polygon selectors with id_field.
- observation_ids: existing native workspace observation item IDs.
- observation_tables: measured-data CSV selectors with station_id_field and optional record_id_field. Original rows, fields and qualifiers are retained.
- aliases: exact study ID to lists of exact source identifiers. Matching trims surrounding whitespace and preserves case, punctuation and source prefixes.
- choices: exact study ID to a retained candidate_id or a full native source reference. An explicit choice creates a saved edition.
- include_all_source_stations: true for an explicitly selected full-source inventory. The prepared study uses its 87-site assessment inventory.

Sources may carry source_sha256 to bind the expected body. Choices preserve collection_id, source_id, native_feature_id and source_feature_index, including native identifier types.

Submit station.geography.build with payload {"selection": SELECTION}, or station.geography.receive with {"upload_id": ORIGINAL_UPLOAD_ID} after the existing /api/upload operation. POST through /api/actions with the original workspace key and operation_id. Browser retries reuse the operation identity.

GET/POST reads are /api/station-geography/catalog, /edition and /verify. Edition reads require id and workspace. State includes data.station_geographies. The original /api/item accepts kind station-geographies. The descriptor provides task-download decoration and workspace restore verification.

## Inspect and revise

The saved edition presents the map, station table, original location candidates, native identifiers, coordinate references, source attributes, observation links and all polygon memberships. Publisher source, assessment edition, cause, designated use, support and publication-state filters match the same original record. Location and geometry-derived watershed filters combine with this assessment selection. The station table and map use the matching station set; the detail panel shows the matching record count and keeps every original record available under its complete-source section.

Use labels remain literal: selecting REC does not silently include a source record labeled AL, REC. Select **Not recorded** to review records whose original support or publication field is empty. Filter choices report distinct stations and original records after the other assessment filters are applied; an incompatible combination stays visible with zero matches. Returning to a saved study restores these workspace-specific selections.

**Download station CSV** exports one row per matching station with only its matching assessment references. **Download assessment records CSV** exports one row per matching original record, including the original source ID and publisher hash, imported-body hash, native record ID or JSON pointer, cause, use, support, publication state, coordinates, mapped and publisher HUCs, and the unchanged original row. The selected filters accompany both downloads. Whole-edition files and the watershed-coverage table retain the complete saved study.

For a concrete original-source check, SV-206 has a 2024 BIO / AL / not_supported record and a separate July 2026 ECOLI / REC / fully_supported record. Selecting BIO together with fully_supported yields no matching record at that station; selecting the July recreation record preserves its own source identity. The five July fully-supported recreation records are SV-206, SV-015, SV-139, SV-073 and SV-352.

Missing and invalid coordinates remain in station GeoJSON with null geometry. Different original locations remain explicit candidates. Identical transformed coordinates preserve every coincident source record. Watershed membership uses polygon covers in the original coordinate reference and retains boundaries and overlaps together. The crosswalk computes membership from point and polygon geometry while preserving the source's own watershed attributes.

Choose a candidate's original location to save a revision through the same queue. **Use this selection** reopens an edition as an editable draft. Session drafts persist through desk navigation and workspace switches; source editions and operations remain retained by the server.

## Exports and reopening

Every build creates:

- analysis.json; stations.geojson; candidate_locations.geojson; watersheds.geojson.
- stations.csv; station_watershed_crosswalk.csv; observation_links.csv; unassigned_observations.csv; source_inventory.csv.
- OPEN_STATIONS.html; package.json; station-geography.zip.

The standalone report includes the actual vector map and all selected stations. Native-source exports preserve every feature in the selected original sources, including features outside the study.

The ZIP retains native originals, all source companions, original manifests, observations and metadata, a complete file inventory and the exact selection. Reopening imports the retained sources, remaps workspace collection IDs, restores choices and measured-data references, and rebuilds an editable edition. Retried receives reuse completed source imports and the completed edition.

## Integrated operation

Use the prepared study for one complete application journey: import its original packages; queue the 87-station build; inspect the map and native station details; save a location revision; download the report, CSV, GeoJSON and ZIP; receive the ZIP into a second workspace; reopen the station identities, measured-data links and retained watershed memberships. Record the actual operation and result IDs with the application delivery.

## Authorship and scientific interpretation

Authored by TokenJunkieLabs. Scientific interpretation: Needs expert review. The responsible scientist interprets the original assessment editions, observation definitions and intended planning uses.

## Published 2024 and July 2026 assessment context

The same station engine also serves the complete 159-station published assessment inventory. Select **Upper Savannah published assessments — 159 monitoring stations** from Prepared studies after importing its native sources.json. The original 87-station 2026 draft study stays available as a separate preset.

This inventory has 192 source records: 108 records from the published 2024 303(d) listing and 84 from the July 28, 2026 TMDL attainment table. Exact station identifiers link each record to the existing retained 705-feature SCDES monitoring layer, eight-feature WQP supplement and the additional RS-21038/RS-22075 WQP source. The published study has 152 exact Atlas locations, five from the eight-site WQP source and two from the additional source. Candidate handling, explicit location choices, point transformation, and polygon membership use the maintained station engine.

The panel offers an assessment-edition filter and expanded cause labels. **TN in assessment causes means Total nitrogen; TN in classified-reach H2OCLASS means Trout Natural.** Source HUC12 assignments remain per edition. RS-06190 retains 030601030602 for its 2024 BIO record and 030601030502 for its July 2026 ECOLI record. The mapped HUC is derived independently from the retained station point and watershed polygons.

Each new station edition exports assessment_links.csv, assessment_sites.geojson, and a report section containing all attached assessment records. Unresolved and ambiguous station identities remain in these tables with their source references and location status. Their feature geometry is null until the normal candidate-selection workflow resolves the location.

The build imports its generated station points and assessment points through the original Workspace source registry. They therefore appear in the existing Spatial review catalogue as MONITORING_STATIONS and STATION_ASSESSMENTS, alongside the retained raster and watershed sources. The native geography ZIP carries the source inventory and assessment outputs; reopening rebuilds the same station and assessment selection in the receiving workspace.

See PREPARED_STATION_STUDY.md for the complete native build and receive command.

## Original JSON station inventories

site_tables can select a complete upstate.water-quality-assessments/v1 JSON bank
directly. Its source station field defaults to site. The complete producer JSON
and companions remain retained; row references include original record-array
index and pointer, native record ID and original publisher-source metadata.
where and where_in accept exact typed field predicates. These select records
without renaming fields, reclassifying causes or altering the original body.
The known published 159-station preset prefers the two complete normalized banks
and retains the existing accepted CSV inventory fallback. Portable receiving
reuses the same reader and exact original array positions.
