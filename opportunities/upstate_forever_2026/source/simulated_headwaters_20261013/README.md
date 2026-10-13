# Simulated Piedmont headwaters: native demonstration

This retained case runs a declared simulated landscape through the maintained Upper Savannah Scientific Workbench. The original importer, native InVEST 3.20 NDR/SDR models, comparison, process report, mapped delivery and portable project produce the results.

## The case

The input grid contains 14,400 thirty-metre cells, covering 1,296 hectares in EPSG:26917. A generated two-tributary terrain drains toward the southern outlet. The sources contain land cover, elevation, annual precipitation, rainfall erosivity, soil erodibility, a restoration mask, model/reporting polygons, and simulated source-water/conservation areas.

The alternative converts 236 pasture cells and 399 crop cells inside a true 90-metre Euclidean buffer of the generated stream-axis segments to forest: 635 cells, or 57.15 hectares. The baseline and alternative retain the same climate, soil, terrain, model profile and grid.

The coefficients are explicit input assumptions. The native `measured-runoff` table enum expresses how NDR interprets a loading coefficient; these particular coefficients are simulated. The model applies its precipitation-proxy scaling once. Assumptions and exact units travel with the imported source edition.

## Operate the complete case

Use the maintained application and its pinned scientific environment. Choose separate sibling directories for the project and output:

~~~sh
python -B source_tools/simulated_headwaters.py \\
  --workspace /owned/simulated-headwaters-workspace \\
  --output /owned/simulated-headwaters-output
~~~

The example paths are replaced by the operator's actual owned locations. The default recipe is this directory's `input-recipe.json`. Source arrays are retained, so Node is not required on the native execution host. `--prepare-only` completes the actual importer, grid, profiles, scenarios and prepared run records; continuing the same command without it executes those saved runs.

The runner writes `demo-receiving.json` after each actual stage. It records the project, source, grid, profile, run, comparison, process-report and delivery IDs, measured stage durations and original archive/reopen results. Completed native stages are reused by their original IDs. The full input receipt hashes each generated file. A partial failure keeps the same operation's completed work available for continuation.

The native-study delivery uses the simulated drinking-water and conservation overlays to exercise all seven map families. The process report separately displays native nitrogen/phosphorus loading, export and retention, sediment process quantities, and changes on common valid cells. The numerical model results are read from completed native outputs.

## Reproduce the input recipe

`generate-inputs.mjs` exports the pure deterministic `buildInputs()` function. It retains every input cell in `input-recipe.json`, plus source geometry, assumptions and input-only checks. Its terrain check verifies descending support and excludes unintended interior pits; native InVEST computes the actual routing and export results.

~~~sh
node --input-type=module -e 'import {buildInputs} from "./source/simulated_headwaters_20261013/generate-inputs.mjs"; process.stdout.write(JSON.stringify(buildInputs())+"\n")' > /owned/reproduced-input-recipe.json
~~~

Compare the reproduced recipe with the retained original before using a changed edition. The source writer creates compressed GeoTIFFs, GeoPackages, the complete biophysical CSV, assumptions and an importable `upstate.sources/v1` manifest.

## Teach and inspect the actual result

[TEACHING_GUIDE.md](TEACHING_GUIDE.md) gives the existing product's source → geography → assumptions → alternatives → native runs → comparison → maps → export → reopen sequence. `source_tools/simulated_headwaters_rehearsal.py` binds the actual receiving IDs to the maintained rehearsal recorder. The recorder captures the original operator, screenshots, recording, timings, downloads and independent archive receiving.

Use a browser host that can open the existing local application. A completed scientific archive can move to that host while preserving the selected project and native results. Actual model time and recorded-result walkthrough time remain separate.
