# Receive observed watershed context in the existing application

This operation receives the complete original Upper Savannah observed hydrology, Eighteenmile study, assessment geography, and published public-water sources into one existing regional scientific Workspace. It uses the maintained source importer, the existing all-87-station assessment mapping code, SpatialReview, SpatialExports, and receiving-water preparation.

## Run the complete operation

From the installed application directory containing model/workspace.py:

```sh
env GDAL_CACHEMAX=16 GDAL_NUM_THREADS=1 \
  /ACTUAL/GIS/PYTHON -B -m source_tools.receive_observed_context \
  --workspace /absolute/path/to/existing-regional-workspace \
  --domain-manifest /absolute/path/to/original-domain/sources.json

```

Use the interpreter already installed with the application's GIS and plotting dependencies. The receiver requires the original regional Workspace. It preserves its current sources, profiles, native runs, and reviews.

The original 217-HUC domain is selected by its retained decoded geometry identity. An already imported matching domain is discovered without another domain argument. A successor or other explicitly chosen HUC12 polygon layer can be supplied with repeated --domain-layer-id ACTUAL_LAYER_ID arguments. The receiver requires a selected original domain so the station–watershed result contains the actual spatial joins.

The installed application contains these complete original inputs:

| Source | Manifest | Source records retained |
| --- | --- | --- |
| Assessment geography | assessment/geography-model-sources.json | All 87 listed station points in three original CRSs, draft cause and priority facts, original metadata and derivation companions |
| Observed hydrology | observations/observed_hydrology_20261013/model-sources.json | Original gauge inventories, 2020–2025 discharge and stage responses, observed tables, qualifiers, dated nutrient results and original Eighteenmile whole-catchment polygon |
| Eighteenmile lake study | observations/eighteenmile_2023/model-sources.json | Published 2023 study, original laboratory activities and qualifiers, explicitly reconciled chlorophyll cohort, same-date and antecedent flow context |
| Public water | source/water_context/20261012/public-water/sources.public-native.json | Original intake points and four original ARJWS/PRWD published protection polygons |

When the maintained eighteenmile_lake_observation_report.sources.json is installed at the application root, the same receiver also imports its complete original study report and the existing offline interactive lake-observation report. HTML documents open with their native companion paths preserved. Additional editions remain selectable through repeated --context-manifest arguments.

Each manifest remains unchanged. Workspace.import_sources retains every original body and companion by content identity. The assessment manifest includes its original operate_assessment_maps.py as a hash-bound companion, so that file remains byte-for-byte original. The maintained continuation of its mapping code lives separately at source_tools/operate_assessment_context.py.

The receiver accepts --hydrology-manifest, --study-manifest, --assessment-dir and --public-water-dir to use the same complete sources from another retained location. Repeat --context-manifest for additional ordinary source editions such as reported point-source discharge. Repeat --context-layer-id to include an existing native context vector by its actual catalog ID.

## Geographic outputs and original tables

The operation creates the original eight review families:

- Regional assessment and monitoring.
- One view for each of four RFP focus HUC12s.
- Eighteenmile assessment and nutrient context.
- Regional nitrogen and phosphorus listings.
- Original assessment-versus-station HUC source differences.

Every context vector is included in each review whose geographic viewport it intersects. Original point datums remain attached to each layer; the maintained spatial engine projects them into the review's EPSG:5070 view. The native point API inspects every assessment station against each selected original domain. The result retains all original polygon covers, overlapping boundary matches, outside-domain outcomes, field values, and source hashes.

SpatialExports produces its maintained PDF, SVG, PNG, source/provenance, annotation, overlay-feature and map-package outputs. The default is Letter at 150 dpi to keep the first complete receiving operation practical on a shared GIS host. --dpi 220 or --dpi 300 and --paper a4 select the existing alternatives. --skip-export still imports the complete source editions and saves native review selections; running again with print rendering enabled creates that explicitly different operation.

Use --primary-layer-id ACTUAL_BASELINE_LAYER and --comparison-layer-id ACTUAL_ALTERNATIVE_LAYER to open the same geographic context alongside completed native model rasters. --mode difference uses the maintained alternative-minus-baseline path, including its exact grid and units checks.

The same receiving operation also calls the maintained PublishedStudyStore importer on the complete original study directory. It registers the study/version and original observation companions in the existing Published studies desk and records that exact study ID, version ID, collection ID and source counts in receiving.json. Repeated receiving reuses the retained study version.

Tables appear as ordinary Sources entries in the existing operator. Source inspection provides original columns and a 30-row preview. Each source edition exposes the complete original body and all companions for download. The receiver also writes index.html and source-inventory.json with actual CSV row counts, units, declared datums, source URLs, source collection IDs, and direct links to the retained original files.

## Four public-water source areas

The receiver reads the existing receiving-waters.public-spec.json, validates the original typed selectors, imports the current public-water source collection and binds it to the four maintained receptor records. receiving_waters.prepare owns the preparation.

The result retains arjws-swpa-1500, arjws-swpa-200, prwd-swpa-1500 and prwd-swpa-200 in EPSG:26917. All four retain their original source_area relation and polygon geometry. The intake reference remains a separate original point. BUFFER_FT remains the agency's published feet field. The workflow writes scenario-source-areas.json in the maintained format so the existing scenario-analysis desk can select these same geographic source areas.

## Resume and reopen

The exact source manifest hashes, public-water specification, project ID, selected layer IDs and map settings identify the receiving operation. Its output directory is:

```text
workspace/observed-context/<operation-id>/
```

The receiver prints the actual directory and complete result. receiving.json records imports, source-water plan, review IDs, map-pack IDs, counts, completed output hashes and attempt history. A per-operation lock prevents two receivers from running that same selection concurrently.

Run the same command after interruption. Source imports reuse their original content identities. Map saving retains the same scientific selections; the maintained map exporter reuses its complete rendered edition or continues retained rendering. The assessment continuation saves each completed native station inspection and its actual watershed joins under station-checkpoints/. A restarted operation reuses those completed station records and finishes the remaining points.

An operation directory with a different admitted selection is rejected before its progress is altered. Failures after admission retain the exact exception and current progress. The original source data and any completed native map or model result remain in the Workspace.

The existing Workspace backup includes observed-context/ and all retained sources and spatial outputs. Application portability must include the assessment source family alongside observations, model and source_tools. In the restored application, run the same command against the restored Workspace and source manifests; filesystem relocation is excluded from the selection identity.

## Reading the observed context

The source manifests and source inventory preserve numerical and geographic support:

- Discharge is original daily mean flow, with approved/provisional/estimated/revised flags and explicit period completeness. Stage has its separate original gauge reference and units.
- Laboratory concentrations keep original dates, time zones, fractions, depths, analytical methods, detection conditions and limits. Published seasonal statistics and individually reconciled activities retain distinct identities.
- The same-date and antecedent flow companion describes the original upstream Eighteenmile gauge alongside the original lake sampling stations.
- The USGS Eighteenmile polygon is the original upstream whole-catchment basin. The reported gauge drainage area remains the separately recorded denominator used by the hydrology producer.
- The draft assessment HUC labels and the native original-point/polygon joins remain separately inspectable.
- Modeled annual mass rasters retain the maintained model's existing units and cell-area conversion. Receiving this context does not transform observed concentrations into annual loads.

All source URLs, original tables, reproduction programs and retained agency bodies travel with their ordinary source editions.
