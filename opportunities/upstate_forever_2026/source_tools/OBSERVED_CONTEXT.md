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

The same receiving operation recognizes the complete reported-discharge, monthly flow, and original routing companions when installed, using observations/eighteenmile_2023/npdes/model-sources.json, npdes/flow_context/model-sources.json and npdes/routing-model-sources.json. Agency outfall points and the distinct indexed routing points retain their original identities. The ordinary application-root eighteenmile_scientific_figures.sources.json and observed_hydrology_context.sources.json bring the retained study figures and the full gauge-flow explorer into the same source inventory. These root manifests keep every native relative path within its retained source edition.

The maintained source.import_observed_context importer runs during the same command. Its observation intake and operator chart are installed with the application. The default study, hydrology and monthly DMR source editions populate fourteen existing observation views; the actual receipt reports whichever complete original editions were selected. Custom --study-manifest and --hydrology-manifest arguments are passed through as their exact selected original files. The saved observations.json lists actual source collection IDs, original table hashes and observation IDs. Repeated views can share the same original rows while selecting different measured or derived columns; counts across views are labeled accordingly.

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

## Scientific report and daily flow explorer

The receiver imports the application-root observed_hydrology_context.sources.json. Its retained report recipe appears in the existing Delivery form's Observed science context selector. The selection binds the complete original study, regional hydrology, reported discharge and routing members, four measured scientific figures, and the offline observed-flow report to one native report edition. Native source views and exported reports preserve their relative file relationships.

The flow explorer opens through the receiver's original-source index and the scientific report's observed source links. It contains every retained 2020–2025 daily row at all 16 gauges, the annual completeness matrix, original qualifiers, 2023 sampling and antecedent conditions, and monthly reported-source quantities with their actual parameter cohorts. Its gauge/year, unit and scale controls work offline; selected daily records download with original response identifiers and record positions.

Rebuild the explorer from the application root with `node source_tools/build_observed_flow_report.mjs`. The existing original hydrology and monthly-flow reproduction commands retain their own complete agency inputs. Use eighteenmile_scientific_figures.sources.json for direct native figure import: it preserves all original seven entries while routing the original sibling inputs through canonical application paths.

## Routine nutrient and flow continuation

When the application-root eighteenmile_routine_nutrient_flow.sources.json is installed, this same command also imports its six original nutrient and flow tables. The canonical manifest retains the original thirteen-file nutrient analysis and all 88 original hydrology source files as companions, including the actual calculation inputs and agency responses. The original nested model-sources.json remains unchanged. It executes the edition's own retained import_into_workspace.py companion with the current application, current Python and selected Workspace. The original importer is verified against its retained companion hash before execution; it remains byte-for-byte part of the original source.

The importer creates two context views of the same 120 dated rows: 96 routine nutrient results and 24 same-activity TKN plus NOx sums. Lower and upper endpoints retain the original censor conditions and conservative concentration interval. Quantified values have equal endpoints. The two views retain the same source records and do not increase the number of independent measurements.

receiving.json records both observation IDs, their collection, row counts and additional receipt nutrient-flow-observations.json. The existing Observed water quality desk opens those views, and source-inventory.json exposes the sampling calendar, station/flow summaries, station contrasts, sole shared-date comparison and June 12 contrast. Resuming the receiver reuses identical native observation editions.

## Expanded calibration gauge context

When source/hydrology-huc05-07-20261013/model-sources.json is installed, the same receiver imports its eight source entries as a separate calibration collection. This edition retains the original thirteen gauges' 2020–2025 daily source responses, calendar-year and calendar-month statistics, 2023 study-period coverage, reference-flow comparisons and original station geometry. Its source IDs keep the huc05-07-calibration- prefix. The earlier sixteen-gauge dated source collection retains its own identity and dates. Source-inventory.json and the existing Sources desk expose the completed tables and all original companions; the existing geographic continuation can use the station layer alongside the retained basin and assessment layers.

## Matched lake observation report

When eighteenmile_lake_paired_analysis.sources.json is installed, the same receiver imports its seven original native source entries. The retained paired-observations-report.html opens alongside the lake report from the original-source index. The scientific report links to the matched-pair report, cross-analyte links and paired microcystin/chlorophyll summaries with their original retained companions. Earlier complete reports retain their own source bindings.

## Complete intake with ordinary Python

Use the same receiver on an ordinary Python host to finish the entire original-source and observation phase before geographic processing:

```sh
"$PYTHON" -B -m source_tools.receive_observed_context \
  --workspace "$WORKSPACE" \
  --domain-manifest "$ORIGINAL_DOMAIN_MANIFEST" \
  --sources-only
```

This imports every selected native source collection and its original companions, registers the published study, creates the fourteen dated context views and the two nutrient endpoint views when that source is present, and writes the source inventory plus a browsable original-source index. No raster or vector calculation is needed for this intake. An existing retained domain collection can be used later; omit --domain-manifest when the selected Workspace already owns that source.

The same receiving.json records state sources_complete, the actual published-study and observation IDs, and the source_phase file hashes. A completed observation/source phase stays recorded if later geographic processing returns an exception. The index links only to files already produced.

On the equipped geographic host, resume the same command with --sources-only removed and the same source selections, map settings and Workspace. The execution flag is excluded from operation identity, so it continues the same output directory. Native source and observation imports reuse their identical IDs before the original public-water and station/map workflow proceeds. If a later command adds or changes a source manifest or scientific selection, that choice retains its own receiving identity.

Running --sources-only against an already complete geographic operation verifies its completed file hashes and returns that complete record unchanged. The existing native backup carries the same source phase, original objects, source views, observation records and receiving directory.
