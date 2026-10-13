# Simulated Piedmont headwaters: complete native demonstration

This case operates one declared simulated landscape through the Upper Savannah Scientific Workbench. The existing importer, InVEST 3.20 NDR/SDR engines, scientific reports, map delivery, field/laboratory workflow and portable project produce the saved results.

## Scientific question

How does the placement of an equal-area forest restoration change the selected model's annual nitrogen, phosphorus and sediment exports?

The baseline covers 1,296 hectares on a 120 × 120 grid of 30-metre cells in EPSG:26917. The retained sources include convergent two-tributary terrain, land cover, annual precipitation, rainfall erosivity, soil erodibility, model/reporting polygons, and simulated source-water and conservation areas.

Two alternatives each convert 236 pasture cells and 399 crop cells to forest: **635 cells, or 57.15 hectares**. The riparian alternative follows the true 90-metre Euclidean buffer of the generated valley axes. The matched control lies outside that corridor and minimizes class-specific precipitation differences using the complete original candidate set. Both alternatives retain the same baseline grid and profile. The control arrives in its own source collection, preserving the original baseline and riparian input edition and run IDs.

The canonical control is `matched-control.json`, reproduced by `generate-matched-control.mjs`; [MATCHED_CONTROL.md](MATCHED_CONTROL.md) records its methods and complete cell matches. Rainfall matching controls the assumed loading contrast closely; retained soil, erosion, terrain and spatial-pattern differences remain part of interpreting the computed response.

The coefficients are explicit demonstration assumptions. The native `measured-runoff` table enum describes the NDR coefficient semantics. The model applies precipitation-proxy scaling once.

## Operate the complete case

Use the maintained application and its pinned scientific environment. Choose separate sibling directories for the scientific project and operation output:

~~~sh
python -B source_tools/simulated_headwaters.py \
  --workspace /owned/simulated-headwaters-workspace \
  --output /owned/simulated-headwaters-output
~~~

Replace these example paths with actual owned locations. The default recipe is this directory's `input-recipe.json`. All original arrays and both intervention masks are retained, so Node is unnecessary on the execution host.

The single driver carries the case through:

1. Input generation, import, shared profile/grid, all three scenarios, actual prepared changed-area calculations, and the saved parameter-study design.
2. The same project's complete field/laboratory campaign: original sample intake, quality review, corrective task, repeat collection and closeout.
3. The native customer-review chapter: authored requests, assigned engineering, revised field evidence, a ready handback, and both complete offline review packages.
4. Native NDR/SDR baseline, riparian and matched-control runs, reusing completed saved runs.
5. One all-alternative comparison and native loading, export, retention and sediment process figures.
6. A seven-family native-study map delivery with the native process report and all five field scientific sources; saved paired nitrogen maps for both alternatives.
7. The existing routing and dimensionless maximum-L parameter course, paired raster products and joint decision reports.
8. A whole-project archive, independent restoration, and fresh-process reopening of original completed runs, maps, field campaign, parameter study and both original customer packages through the restored application.

`--prepare-only` imports the real sources and prepares the grid, scenarios, footprints and saved parameter-study design. Continue the identical command without that option to execute the prepared case. `--field-only` prepares the same selections, completes the field/laboratory chapter and its customer review/handback packages using the installed GIS/application stack, then returns before checking or running InVEST. Continue the original normal command to reuse those completed chapters with the model runs.

`demo-receiving.json` records actual saved identities and elapsed stage times after each stage. A retry uses the same output directory and original project. Completed model and field operations retain their original results. A failed stage records its actual exception so the source can be repaired and that operation continued.

## Read the results

Original InVEST 3.20 N/P export rasters contain **kg/ha/year**, and original sediment export rasters contain **metric tonnes/ha/year**. The Workspace's integrated output cells contain annual mass after multiplication by the actual cell area once. A 30-metre cell covers 0.09 hectare. Native watershed-vector totals already contain annual mass. Read each selected artifact's unit.

Native signed change is alternative minus baseline. Paired ensemble and decision avoided-export products label their baseline-minus-alternative convention separately. Read original full-domain totals and actual common-valid-cell comparisons with their respective supported areas.

The current SDR `l_max=122` caps the dimensionless slope-length factor L. The parameter course compares the maintained MFD/D8 routing and Lmax 122/333 choices while retaining the original profile first. Its ranges describe those named choices. [PARAMETER_COURSE.md](PARAMETER_COURSE.md) explains the retained support groups, original member identities and decision reports.

The field chapter contains explicitly simulated sample concentrations and collection events. Native laboratory/QC services calculate duplicate precision, preserve the censored blank and operate corrective work. [SIMULATED_FIELDWORK.md](../../docs/SIMULATED_FIELDWORK.md) gives the full operating sequence. The field concentration exercise and annual watershed-model outputs have distinct scientific uses.

## Preserve and receive the working project

Archives have separate stable editions bound to the delivery, saved views, field operation, ensemble, all six customer-operation/review identities, and the selected customer and receiver source editions. Earlier archives remain intact when an added chapter produces a new edition. A publication interrupted after writing an archive or restored directory recovers from that original complete inventory.

The receiver starts a fresh isolated interpreter from the restored application and opens its selected completed runs, delivery, both source-bound map reviews, field closeout, original parameter-study selection and customer review. Its source files, reports, native rasters, implementation history and ensemble products travel in the maintained whole-project package. Keep the complete original customer package directory, recorded in `demo-receiving.json` under `customer_review_packages.directory`, beside that project archive. The restored application receives both original review packages into an independent output directory, retaining the six teaching identities and the current native Worklist. [SIMULATED_CUSTOMER_REVIEW.md](../../docs/SIMULATED_CUSTOMER_REVIEW.md) describes the three phases and exact receive command.

The owner-directed build interval ends **13 October 2026 at 14:00 UTC / 10:00 Eastern**. The executing owner preserves completed work and the current saved stage at that cutoff.

## Reproduce the retained inputs

`generate-inputs.mjs` exports the pure deterministic `buildInputs()` function. It preserves every source cell, geometry and declared assumption in the original recipe:

~~~sh
node --input-type=module -e 'import {buildInputs} from "./source/simulated_headwaters_20261013/generate-inputs.mjs"; process.stdout.write(JSON.stringify(buildInputs())+"\n")' > /owned/reproduced-input-recipe.json
~~~

The native source writer emits compressed GeoTIFFs, GeoPackages, the complete biophysical CSV, assumptions and importable source manifests. The separate control receiver binds the exact original recipe hash before importing its mask. The optional native routing diagnostic uses the maintained PyGeoProcessing D8/MFD algorithms on that same terrain.

## Teach the actual result

[TEACHING_GUIDE.md](TEACHING_GUIDE.md) follows source → geography → assumptions → alternatives → native calculation → comparison → maps → field/lab → customer review → export → reopen. It includes the actual product controls, scientific units, same-area experiment, corrective field workflow and recording course.

`source_tools/simulated_headwaters_rehearsal.py` binds the original completed case IDs to the maintained recorder. A qualified browser host can receive the completed scientific archive and open those saved results. The original receipt and teaching guide travel inside the final teaching ZIP. Model calculation time, transfer time and recorded walkthrough time remain separate actual measurements.

## Model methods

- [InVEST 3.20 NDR guide](https://storage.googleapis.com/releases.naturalcapitalproject.org/invest/3.20.0/userguide/en/ndr.html)
- [InVEST 3.20 SDR guide](https://storage.googleapis.com/releases.naturalcapitalproject.org/invest/3.20.0/userguide/en/sdr.html)
