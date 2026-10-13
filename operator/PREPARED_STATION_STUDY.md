# Prepare and operate Upper Savannah assessment studies

The original 87-station study joins the retained 705-station SCDES catalogue, eight original WQP station records, the extracted 101-row assessment inventory and the complete upstream HUC12 domain. Each input is selected by its retained byte identity. The domain's HUC12 field is discovered from its native schema.

## Choose the retained assessment coverage

| Prepared study | Original assessment records | Exact station IDs | Original inventories |
| --- | ---: | ---: | --- |
| Upper Savannah assessment — 87 monitoring stations | 101 | 87 | Retained 2026 draft extract |
| Upper Savannah published assessments — 159 monitoring stations | 192 | 159 | Published 2024 listing and July 28, 2026 TMDL status |
| Upper Savannah assessment editions — 164 monitoring stations | 293 | 164 | All three retained inventories |

Choose the all-editions study to inspect the complete retained assessment coverage.
The original 87- and 159-station selections remain available for their own source
scope. The all-editions selection has 82 stations shared between those selections
and five draft-only sites: RL-24073, RS-24163, SV-236, SV-344 and SV-376.
Their original locations are already in the retained monitoring and WQP sources.
Every cause/use record remains attached to its original edition, source row and
publisher watershed assignment.

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

## Build the published 159-station assessment study

Import the completed published inventory together with the original monitoring, WQP8, additional WQP2 and domain sources. The accepted inventory is the exact file results/assessment-records-domain217.csv in the complete scientific source bank [F0C8KECMA4V](https://tokenjunkielabs.slack.com/docs/T0BRETUB5TK/F0C8KECMA4V): 111,624 bytes, SHA-256 01f1a0262bb719f39d4b6c8b6e690bbf670d9aea83cbe0f532daf81b0c6a09f7. The component installer retains that unchanged file beside source/station-assessment-context/sources.json using basename assessment-records-domain217.csv. This is an additional source collection, so the original draft inventory remains available.

Run from the existing application directory:

    python -m model.station_study --workspace WORKSPACE \
      --create-workspace --build \
      --study-id upper-savannah-published-assessments-2024-2026-159 \
      --source-manifest MONITORING/sources.json \
      --source-manifest WQP_SUPPLEMENT/sources.json \
      --source-manifest ORIGINAL_DOMAIN/sources.json \
      --source-manifest PUBLISHED_INVENTORY/sources.json \
      --source-manifest WQP_ADDITIONAL_TWO/sources.json \
      --receive-workspace SECOND_WORKSPACE --create-receiving-workspace

The existing workspace creation, native build, portable archive and receiving commands are shared by both studies. This selection requires 192 records at 159 exact station IDs, including both published editions. It resolves original inputs by their retained byte identity. The 2024 records carry their original assessment cause/use and published HUC; the July 2026 records also carry TMDL support status, report and approval date. Five of the retained eight WQP stations belong to this published inventory. The accepted draft-study inventory overlaps the published inventory at 82 station IDs; 152 station IDs match the complete retained source layer, and the additional WQP2 source supplies RS-21038 and RS-22075.

The original station table, candidate choices, mapped watershed filter and full polygon coverage continue to operate. The assessment edition filter narrows the station map/table and filtered station CSV. Watershed coverage describes the full selected study inventory and includes zero-station polygons. Its cause counts display expanded labels.

Each assessment record retains a publisher_huc12 and separately receives geographic_huc12s plus publisher_huc_relation. Multiple publisher assignments are retained, including the two original RS-06190 assignments. The native receive command compares the original station identities, mapped memberships and assessment records after reopening.

The build creates assessment_links.csv, assessment_sites.geojson, and spatial-sources.json alongside the existing full station outputs. Both point layers join the maintained Spatial review source catalogue automatically. Complete original inventory rows, source editions and candidate identities remain available in the panel, report and portable archive.

## Use the original normalized JSON banks directly

The published 159-site preset now prefers both complete retained JSON banks when
they are imported. It preserves the existing accepted CSV inventory as a fallback.
The normal station build and receiving operation remain the same.

Import the existing full producer source manifest from F0C8KECMA4V, containing:

- inputs/303d-2024-pdf-table-normalized.json, 2,674,649 bytes,
  SHA256 69e6894001fdcfa0130d8be532a31655eda22486a4044079665e8ee614eb5b0c.
- inputs/tmdl-attainment-native-20260728.json, 1,260,570 bytes,
  SHA256 cceaf00eb0fc4cc85eabb67fbd2a9b5d843bb0cc0c7ab8da54d2108f025c2522.

Each original body has schema upstate.water-quality-assessments/v1. The exact
retained 217 original domain HUC12 values filter records by their publisher huc12.
This selects 108 published 2024 records and 84 July 2026 records: 192 distinct
source records at 159 stations. Both complete statewide bodies and every declared
source companion travel in the geography ZIP; selected rows are not rewritten as
a second CSV source.

Every row reference retains the original records[index], JSON pointer, native
record id, publisher source ID/hash and the imported normalized body SHA. These
are different identity layers. Original source_row and source_page remain source
metadata: all 813 TMDL records have source_row=1, so those fields cannot identify
or deduplicate records. The original 2024 source has multiple cause records for
some source rows. Every record remains distinct.

The existing inventory selector accepts known original JSON inventories as well
as CSV. Source references can specify typed where or where_in filters against
actual original fields. The prepared study writes its exact HUC selection into
the immutable source reference. Additional point sources and location choices
continue to use the existing native station path.

### Complete the published study's two additional station locations

The published 159-site study selects 152 sites from the original SCDES705 source,
five from the existing WQP8 supplement, and RS-21038 plus RS-22075 from the
additional official WQP station-page source. The original 87-site preset is unchanged.
The additional source ID is scdes-wqp-assessment159-additional-two-20261013;
body wqp_two_monitoring_sites.geojson, 2,433 bytes, SHA256
5588a64fbae5229687aef7063948083f05b5f0639dfd108ae0c3db40614677cd.
It preserves native WQP station IDs, all reported metadata, source-page references
and WGS84 coordinates. Its declared representation is station-page metadata with
copied native points; it is not a downloaded publisher CSV.

Run the existing complete operation with these retained source manifests:

    python -m model.station_study \
      --workspace ACTUAL_STUDY --create-workspace --build \
      --study-id upper-savannah-published-assessments-2024-2026-159 \
      --source-manifest MONITORING/sources.json \
      --source-manifest WQP8/sources.json \
      --source-manifest ORIGINAL_DOMAIN/sources.json \
      --source-manifest ES9960_COMPLETE_ORIGINALS/sources.json \
      --source-manifest WQP_ADDITIONAL_TWO/sources.json \
      --receive-workspace ACTUAL_RECEIVING --create-receiving-workspace

The preset binds both normalized assessment banks and the same exact original
217 HUC selection. The source summary identifies its JSON selection and additional
location source. The existing CSV-backed alternative uses the same additional
point source and source-preserving native operation.

The component installer also retains the accepted original CSV beside
source/station-assessment-context/sources.json. Its original body is 111,624
bytes with SHA256 01f1a0262bb719f39d4b6c8b6e690bbf670d9aea83cbe0f532daf81b0c6a09f7.
This fallback manifest can be imported directly when the original statewide
JSON banks have not yet been received. Both paths preserve the original 192
edition-specific records and use the same three native station sources.

## Operate all three retained editions together

The complete preset adds the unchanged 101-row draft inventory to the published
192-row selection. It retains 293 distinct edition records at 164 station IDs,
using the same monitoring, WQP8, WQP2 and original 217-polygon domain sources.
The complete selection has 154 exact monitoring-layer locations, all eight WQP8
locations and the two additional WQP2 locations, with one original point per site.
Its source summary includes the three edition counts, the shared station count,
the five draft-only stations and 77 distinct publisher HUC12 labels. The mapped
watershed memberships still come from the actual point/polygon operation.

Run from the current application directory, selecting actual source directories:

    python -m model.station_study \
      --workspace ALL_EDITIONS_WORKSPACE --create-workspace --build \
      --study-id upper-savannah-assessments-all-editions-164 \
      --source-manifest MONITORING/sources.json \
      --source-manifest WQP8/sources.json \
      --source-manifest ORIGINAL_DOMAIN/sources.json \
      --source-manifest ES9960_COMPLETE_ORIGINALS/sources.json \
      --source-manifest WQP_ADDITIONAL_TWO/sources.json \
      --assessment-csv WQP8/assessment_listed_causes_2026_draft_original.csv \
      --receive-workspace ALL_EDITIONS_RECEIVING --create-receiving-workspace

The accepted original published CSV manifest can replace the complete normalized
JSON-bank manifest when that is the available retained inventory. The additional
draft input remains the exact 14,033-byte CSV described above. Existing original
source imports are reused. Select distinct study and receiving directories; the
same native build, full source archive, reopen comparison and editable operator
selection serve all three presets.

### Read cause and use support together

The retained published 2024 selection has 108 cause records at 94 stations.
The July 2026 selection has 84 E. coli/recreation records at 84 stations.
Those published cohorts share 19 stations; their original cause/use records
remain distinct. The draft extract has a different retained geographic scope,
so differences between these inventories are not a concentration trend.

In the July 2026 rows, five stations have the original recreation/E. coli
support value Fully Supported: SV-206, SV-015, SV-139, SV-073 and SV-352.
SV-206 also retains a BIO/AL listing in both the 2024 and draft inventories;
SV-139 retains DO/AL. Read the support field together with its original cause,
designated use and edition rather than assigning one station-wide status.

For the Lower Eighteenmile publisher watershed 030601010602, the original
listing records include SV-268 with TN, TP and TURB, and SV-233 with TURB.
The separate July 2026 ECOLI/REC rows at SV-135, SV-233 and SV-268 have support
value Not Supported. These records provide source-specific context for the
existing nutrient, turbidity and microbial observations and model studies.
Select the original edition and cause in the maintained station panel; the full
293-record export preserves their exact source representations.

Original public documents: [2024 303(d) listing](https://www.des.sc.gov/sites/des/files/Documents/BOW/WaterQuality/303dList2024.pdf), [July 28, 2026 TMDL attainment status](https://des.sc.gov/sites/des/files/Documents/BOW/WaterQuality/TMDLAttainmentStatus.pdf), and [2026 draft Integrated Report](https://apps.des.sc.gov/PublicNotices/SearchAndDisplay/PDF/302110). The unchanged retained source bodies and source-specific geographic selections are identified above.
