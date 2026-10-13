# Utility-focus microbial study in the scientific Workspace

The received source edition contains **730 original E. coli activities at 36 stations**, covering the 2021–2025 query period. The maintained Station geography service links those observations to their original WQP coordinate records and, when selected, the original 217-HUC watershed domain. This receiver supplies the complete native selection, imports the source companions and saves the resulting study in the existing desk.

The complete manifest, raw publisher responses, reproducible Node compiler, offline map and record explorer were delivered together in [PR 2988](https://github.com/woahwhattheheck/public-commons-sprint-2026/pull/2988), under source/ecoli_utility_context/20261013/.

## Receive and open the study

Run from the complete application root with the normal GIS Python environment and an existing scientific Workspace:

~~~bash
python -m model.utility_microbial_study \
  --workspace /absolute/path/to/scientific-workspace \
  build
~~~

The operation imports or reuses the original source collection, prepares the actual native station selection, invokes the maintained station_geography.build, verifies the saved edition and returns:

- The original source collection ID.
- The microbial operation ID and its retained selection.
- The native Station geography edition and build IDs.
- The resulting spatial source collection.
- The complete native report, station maps, original observation links and portable archive descriptors.
- The local source-view path for the original offline microbial record explorer.

Open **Station geography** in the same Workspace and select **Utility-focus E. coli observations — 2021–2025**. Its saved edition appears through the existing catalogue. Open the original observation explorer from the original source collection to use the dated concentration/limit plot, filter controls, full 63-field inspection and embedded original downloads.

The expected completed native study has 36 located stations, 730 linked original activities and zero unresolved or unassigned records. The source retains both utility-focus selections:

| Source context | Stations | Original records | Geographic membership |
| --- | ---: | ---: | --- |
| ARJWS | 5 | 142 | Original WGS84 station points within the four original WBD HUC12 polygons |
| PRWD | 31 | 588 | Original publisher HUC8 03060102, matching the retained 32-HUC upstream union |

All original WQP station identifiers remain intact. No alias selection is required. The original field replicate remains among the native 730 links; the offline explorer offers its explicit routine/replicate selector.

## Prepare without operating the GIS engine

~~~bash
python -m model.utility_microbial_study \
  --workspace /absolute/path/to/scientific-workspace \
  prepare
~~~

Preparation uses Python's standard library and the existing Workspace source importer. It receives the full original source, verifies the station/table identities and retains the exact selection. Its response includes the normal action station.geography.build and payload {"selection": ...} for the existing task service.

The retained files are under:

~~~text
utility-microbial-studies/<operation-id>/
  selection.json
  preparation.json
  receiving.json
~~~

The receiving.json record appears when the native build completes. The Station geography engine owns the actual saved maps, report and complete portable ZIP.

## Preserve the original station coordinate systems

The native study reads the source's original station CSV coordinate strings. Its 34 WGS84 stations use EPSG:4326. USGS-02177000 and 21GAEPD_WQX-RV_01_266 declare NAD83 and use EPSG:4269. The maintained Station geography reader performs the CRS transformation for each source group before any original watershed membership calculation.

Preparation retains two ordinary vector sources, one per declared datum. The source GeoJSON preserves the original numeric positions at the precision represented by the CSV, every original station attribute, the original coordinate strings and source row. Its `coordinate-derivation.json` records the 36 exact identifiers, original CSV body hash, fields and datum grouping. All 22 original microbial files travel as companions under `original/`, keeping the offline report and its source links intact. The native coordinate collection is recorded in `selection.microbial_context.coordinate_source_collection_id`.

The complete source edition remains unchanged. Its independent offline map retains the original WQP display positions. A native study uses the datum-specific coordinate sources, so a new operation identity distinguishes this selection from an earlier common-display-point selection. Existing saved editions reopen with their own retained original selections.

The native coordinate working material is retained in `utility-microbial-coordinate-sources/<identity>/`. An ordinary full Workspace backup includes this directory and the imported source objects. A repeated preparation reconstructs the same native sources from the already retained original CSV and source collection.

## Select the original watershed domain

The default --domain-mode auto inspects already retained model-domain sources and accepts only the original decoded 217-HUC source with SHA256:

~~~text
2300d9b32a513d70503222a5d2e782e032107297214036a58e8b444a312169af
~~~

A matching source supplies the exact native HUC12 field and its own original coordinate reference. The existing geometry engine transforms the original station points into that CRS, retains every interior/boundary/overlap relation, and preserves the native source identity.

If the full original domain is not yet present, the operation still creates the source-linked station study. Its watershed selection remains empty and the saved source context explicitly records that state. Utility membership continues to follow the original microbial source edition. The publisher's generalized Tugaloo display outline is retained with that edition for its offline map.

To require the original domain as part of a particular saved edition:

~~~bash
python -m model.utility_microbial_study \
  --workspace /absolute/path/to/scientific-workspace \
  --domain-mode required \
  build
~~~

To choose a specific already imported original domain source:

~~~bash
python -m model.utility_microbial_study \
  --workspace /absolute/path/to/scientific-workspace \
  --domain-collection ORIGINAL_COLLECTION_ID \
  --domain-source ORIGINAL_DOMAIN_SOURCE_ID \
  build
~~~

Both the body selection and decoded original hash are checked. A new edition is retained when the actual domain selection changes; earlier point-only studies remain available. Use --domain-mode none for an explicitly selected point-and-observation edition.

## Continue after transfer or interruption

The complete original source directory can be received at a different location:

~~~bash
python -m model.utility_microbial_study \
  --workspace /absolute/path/to/scientific-workspace \
  --manifest /absolute/path/to/20261013/source-manifest.json \
  build
~~~

Once that exact source edition is imported, the local application copy is optional:

~~~bash
python -m model.utility_microbial_study \
  --workspace /absolute/path/to/restored-workspace \
  --retained-only \
  build
~~~

The receiver identifies the original collection by its retained manifest SHA256 and verifies the expected point, result-table and report bodies through the ordinary Workspace source reader. Repeating a selection reuses the same operation and the engine's saved station edition. Separate operation locks preserve its receiving records during concurrent requests.

Reopen a completed receiving by its actual operation ID:

~~~bash
python -m model.utility_microbial_study \
  --workspace /absolute/path/to/restored-workspace \
  inspect --operation-id SAVED_OPERATION_ID
~~~

Inspection verifies the saved selection and original Station geography files, then resolves the observation explorer from the restored source collection's current local path.

## Scientific source interpretation

The receiver passes each complete original result row into the native observation_tables contract. The 63 publisher fields, source filename and row ordinal remain available in every observation link. Original date/time fields, analytical methods, units, qualifiers, detection/quantitation limits and blank result values stay unchanged.

The original observations include 554 numeric measurements, six above-limit results, 67 below-limit results, 102 not-detected results and one not-reported result. The analytical methods and actual limits determine each source record's meaning. The standalone explorer displays these conditions separately, while the Station geography study supplies the shared source identities and spatial context used by the wider project.

The original utility-focus assignments and any subsequently selected full-domain geometric memberships are retained as distinct fields. The former follows the source edition's publisher attributes or original four-HUC point selection; the latter is the existing native geometry engine's actual relationship to the supplied original domain.

## Complete transfer

The normal Station geography ZIP carries its selected station/result source bindings and their complete companions, including the independent original microbial explorer and all of its relative files. The generated spatial collection lets the existing GIS workflow select the mapped stations through its ordinary source catalogue. A complete Workspace backup also retains the microbial preparation/receiving folder and the native saved edition.

The retained predecessor source edition manifest is pinned to SHA256:

~~~text
ee6d5cc19e2a98b799db33df08026c6020a9a122f5cfb4ab83f1e415476dee23
~~~

Its expected original result table SHA256 is b6cf7d334c6b8bb1a174374c30e8ea3081dd1f05be2418040272c581a49264a8; its selected original station GeoJSON SHA256 is 533e91201e09aa1103289722f0077edb496f4ed319deb6a4b58771fb7073a907. These are the same complete bodies delivered in the source edition.

## Original comments and presentation editions

The current complete source edition displays original result, activity and laboratory comments beside each result and in plot descriptions. Exactly 72 original result comments contain Information Only or the publisher's Infomation Only spelling. The original 24,000 MPN/100mL result at RV_01_14 on 24 March 2025 carries that comment about analysis after eight hours. Its value remains the publisher's measured value. The source-comments control can retain all records, exclude that explicit marker, select only that marker, or select records with any original comment. Every printed view states this choice; the selection JSON and selected original-field CSV retain it alongside the actual source identities.

The source manifest declares presentation edition `20261013-comments-v2` and pins the complete predecessor at commit `817335bc6d2a9130e203a48e63ecab91e0094003`. Its 19 original data and science members are unchanged; the compiler, HTML and full companion manifest are a coordinated presentation successor. A receiver with an explicit manifest selects that exact known edition. Retained-only receiving prefers the current edition if present and otherwise reuses the original retained edition. Each native selection records its actual source-manifest hash, and the report body is verified against that edition's hash. Existing retained studies continue to use their own original collection and report.
