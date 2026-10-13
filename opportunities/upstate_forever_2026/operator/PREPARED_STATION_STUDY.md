# Prepare and operate the 87-station Upper Savannah study

The prepared study joins the retained 705-station SCDES catalogue, eight original WQP station records, the extracted 101-row assessment inventory and the complete upstream HUC12 domain. Each input is selected by its retained byte identity. The domain's HUC12 field is discovered from its native schema.

## Import retained source packages

Use the Source intake desk to import the three sources.json manifests for SCDES monitoring, the WQP supplement and the 217-HUC12 domain. The station-study command performs the same native imports in the selected workspace:

    python -m model.station_study --workspace WORKSPACE \
      --source-manifest MONITORING/sources.json \
      --source-manifest WQP_SUPPLEMENT/sources.json \
      --source-manifest ORIGINAL_DOMAIN/sources.json \
      --assessment-csv WQP_SUPPLEMENT/assessment_listed_causes_2026_draft_original.csv

Run the command from the application directory. WORKSPACE identifies the same workspace selected in the operator. The source directories contain the retained source packages. Repeated use reuses collections by original manifest identity. The command retains the unchanged assessment CSV as a native table source and saves the complete editable selection. Its output supplies the collection IDs, selection path and stable queue operation identity.

## Public source provenance

The station inventory comes from the [South Carolina 2026 draft Integrated Report](https://apps.des.sc.gov/PublicNotices/SearchAndDisplay/PDF/302110), physical PDF pages 67–71, and its [public notice](https://apps.des.sc.gov/PublicNotices/SearchAndDisplay/Display/38165). The retained extraction expands original rows by listed cause and preserves station descriptions, use/cause/priority fields, page and section. The 14,033-byte CSV has SHA256
545a4e1413012b8f17c81c8afe815dd1e225ade5f5b9792ca22e83ef8723307f.

The monitoring catalogue is the retained 705-record response from the [SCDES original monitoring layer](https://gis.des.sc.gov/gisserver/rest/services/water/BW_Monitoring_Stations/MapServer/9), SHA256
14b1a945ee8d5f172f63435b4fd955e9dada6894fcbca2964160c6e2e52d79f0.

The [original WQP eight-station CSV](https://www.waterqualitydata.us/data/Station/search?siteid=21SC60WQ_WQX-SV-376%3B21SC60WQ_WQX-RS-24163%3B21SC60WQ_WQX-RS-21014%3B21SC60WQ_WQX-RL-21217%3B21SC60WQ_WQX-RL-24073%3B21SC60WQ_WQX-RL-21209%3B21SC60WQ_WQX-RS-22078%3B21SC60WQ_WQX-RL-21225&mimeType=csv) preserves 37 fields, the provider-qualified station identifiers and WGS84 coordinates. Its 3,640 bytes have SHA256
21022c3f3b46fb0bae6e341cde74880ec2e395528592f9168742f53af60b533e.
The source-preserving GeoJSON companion has SHA256
d7322856d96cdd6898a5cef555e97529f99ec4d6dad7ab45d18f4d53f3b646e6.

The watershed input is the retained model-domain.esri.json.gz and adjacent sources.json. The decoded native body is 11,220,042 bytes, SHA256
2300d9b32a513d70503222a5d2e782e032107297214036a58e8b444a312169af.
Its source is the [original national WBD HUC12 layer](https://hydro.nationalmap.gov/arcgis/rest/services/wbd/MapServer/6), using the actual retained 217-polygon study-domain selection.

## Operate the study

1. Open the application and select the prepared workspace.
2. Open **Station geography**, then **Build this study** under **Upper Savannah assessment — 87 monitoring stations**.
3. Follow the original task drawer. On completion, inspect the station map and table.
4. Open a station to inspect its source identifier, original coordinate reference, assessment rows and geometry-derived watershed memberships. Retained source attributes remain available alongside the computed crosswalk.
5. Select an original location candidate to create a revised saved edition.
6. Download the complete station table, native-source inventory, GeoJSON layers, geographic crosswalk, report and ZIP.
7. In a second workspace, receive the ZIP through Station geography and continue editing the reopened selection.

The catalogue retains 705 original Savannah station features. The assessment selects 87 study sites, with 79 locations from the state source and eight from WQP. The native-source export keeps the wider catalogue available for later studies. Measured observations can be added through the existing observation selectors with their values, units, qualifiers and methods preserved.

## Queue and portable receiving

The prepared command returns action station.geography.build, payload containing the complete selection, and operation_id. Submit those values with the original workspace key to /api/actions. The browser's prepared-study button uses this same queue.

For an integrated operation, build the prepared study, inspect its native map and details, save a candidate revision, export all deliverables, receive the complete ZIP into another workspace and reopen the station identities and watershed memberships. Record the application route and actual operation/result IDs with the delivery.

## Inspect the original assessment context

The saved station screen separates original inventory rows from linked observation rows. For this prepared study the retained inventory contains 101 listed-cause rows at 87 stations. Open **Original listed cause** to select a published cause code; its count is the number of distinct stations carrying that code. The table and map follow the same cause, location and text filters. Search also includes original station descriptions and counties.

Open a station to read the published cause, impaired-use code, priority, county and original PDF page. Expand **Original inventory rows and source references** to see the complete unchanged row, retained source identity and extraction row number. Cause and priority codes keep their published meanings and are not used as a new model score.

Use **Download filtered CSV** to export every matching station, including rows beyond the current table page. The CSV retains the saved edition ID, WGS84 location when available, watershed memberships, published assessment codes and complete original inventory references. The complete edition exports remain available for portable receiving and further editing.

## Work from a watershed to its original study stations

Use **Geometry-derived watershed** to select a retained polygon. The station map and table use the existing saved point/polygon memberships. The map focuses on that polygon while keeping the surrounding domain visible. Location, listed-cause and text filters continue to combine with the watershed selection. The menu also includes stations outside all retained polygons and stations whose location is unresolved.

Open **Watershed station coverage** to inspect every retained polygon, including those with zero selected study stations. Each row shows its exact watershed identifier and native name, distinct station count, listed cause counts, original inventory rows, linked observation rows, boundary/overlap station counts and original source. Click a watershed identifier to use it in the map and station table. Search this coverage table by watershed, native name, station identifier or listed cause.

**Download coverage CSV** exports all matching watershed rows across all pages. It retains exact station IDs, per-cause distinct station counts, boundary/overlap counts and the complete original watershed source reference. The station table's **Download filtered CSV** exports the corresponding selected station records and their assessment references.

Counts describe the selected saved study. Zero means no selected study station lies in that polygon. A boundary or overlap station appears in every matching watershed; adding watershed station counts can therefore count a station more than once. Original assessment rows and observation rows remain separate. These geographic inventory counts do not estimate pollutant loads or monitoring effort. Source-specific polygon identities are retained even when multiple sources use the same watershed identifier.

The watershed filter, coverage-table search and page are retained for the selected Workspace during the browser session. Complete edition exports and editable portable receiving retain the unchanged scientific results and original source packages.

## Complete the native study and portable reopen in one command

The original source study can run in its own actual Workspace. It needs the retained source packages, the complete application and its GIS dependencies. It can be created before a model programme finishes.

From the current application directory, run:

    python -m model.station_study \
      --workspace STUDY_WORKSPACE --create-workspace \
      --source-manifest MONITORING/sources.json \
      --source-manifest WQP_SUPPLEMENT/sources.json \
      --source-manifest ORIGINAL_DOMAIN/sources.json \
      --assessment-csv WQP_SUPPLEMENT/assessment_listed_causes_2026_draft_original.csv \
      --build \
      --receive-workspace RECEIVING_WORKSPACE --create-receiving-workspace

Choose distinct actual directories for STUDY_WORKSPACE and RECEIVING_WORKSPACE. Existing valid Workspaces are reused; the creation flags create only a missing Workspace manifest. The same retained source hashes resolve the original study. The native build saves its complete exports and original-source ZIP, then the existing receiving implementation imports that ZIP and rebuilds the editable selection in the second Workspace.

The JSON result includes both real project identities, edition IDs, summaries, all saved export paths and hashes, and the original ZIP's absolute path. Portable receiving compares the original station IDs, location statuses, coordinates, selected source identities, complete watershed memberships, observation counts and full summary. Source collection IDs may change naturally when originals are imported into another Workspace; their original source IDs, hashes and feature identities are preserved.

Repeat the same command and paths to reuse retained imports, completed build and receiving state. A missing required original source returns the prepared-study input list with exit2. Successful complete execution returns exit0 with both editions. Open those Workspaces in the existing operator to inspect the station map, original assessment rows, watershed coverage and editable source selection.
