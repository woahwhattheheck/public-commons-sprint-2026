# Regional execution and delivery

The regional job uses the existing scientific Workspace, original InVEST 3.20.0 engines and existing operator receiving path. It starts the scientific core when the inputs required by the selected model are complete. Parcel, protection, hydrography, wetlands, drinking-water and high-quality-water editions can be added afterward without changing that core's source collection, grid or native run IDs.

## Installation

Add model/regional_job.py and model/regional_scenarios.py to the maintained application alongside the selected-model core update, which exposes model.common.selected_models and required_roles and supports Workspace.prepare_grid/prepare_run selections.

Use the existing equipped Linux interpreter. Where an isolated scientific environment is needed, the official InVEST installation documentation recommends conda-forge. The installation selection is:

    micromamba create -y -p /owned/invest-3.20 \
      -c conda-forge --strict-channel-priority \
      python=3.11 natcap.invest=3.20.0 rasterio fiona pyproj \
      shapely matplotlib reportlab pyshp

Do not replace an existing shared environment. Select an owned prefix and reuse its installed dependencies. The original model.cli runtime entry verifies the exact InVEST version and published NDR/SDR module identities. The native log and completed core result identify the executed model selection.

Official source: https://invest.readthedocs.io/en/3.20.0/installing.html

## Scientific plan

Create a JSON file with schema upstate.regional-core-plan/v1 and these fields:

| Field | Selection |
| --- | --- |
| title | The name of the original scientific selection |
| sources | Object containing path and sha256 of the actual composed upstate.sources/v1 manifest |
| grid | Existing Workspace grid specification with its source_collection_id omitted |
| profile | Existing sourced profile with source_collection_id omitted |
| baseline | Original-land-cover scenario with title, reason, kind baseline and empty patches |
| models | Optional list: ndr, sdr, or both; omitted means both |

The grid retains its input_sources role bindings, reporting_area, model_domain and positive upstream_buffer_m. Use the actual prepared canonical 30 m NLCD raster as its reference. NDR requires DEM, NLCD and PRECIPITATION. SDR requires DEM, NLCD, R_FACTOR and K_FACTOR. The combined run requires all five. Any models fields in the grid and profile must agree with the top-level selection.

The profile selects the actual biophysical_source_id and named, source-supported algorithm parameters. Selected physical rasters must have their units and resampling/conversion rules in their source entries. Climate and terrain preparation should consume the same canonical grid edition.

Execute from the maintained application root:

    python -B -m model.regional_job run \
      --workspace /owned/study \
      --plan /owned/core-plan.json \
      --source-reference ORIGINAL_APPLICATION_REFERENCE \
      --output /owned/core-result.json

One regional-model/<selection-id> directory retains the original plan, source manifest, source/application identity, progress and completed core result. The native run ID is recorded before execution. Resume with the same workspace and original plan; completed native stages are consumed through Workspace.run.

The completed upstate.regional-core-result/v1 includes workspace ID/path, models, scientific source collection and manifest hash, grid/profile/baseline scenario/run IDs, original native model outcome and application source inventory. Changing the scientific input manifest, profile, grid or application selection creates a separately identified operation. Late delivery context is imported through the finish command.

## Scenarios and late delivery context

Run actual future land-cover scenarios through the existing experiment/native operator on the retained grid and baseline profile. The experiment owner keeps its selected scenario masks and run IDs. Parameter-sensitivity runs are separately named comparisons; they do not replace the future land-cover selections.

Prepare a JSON document with schema upstate.regional-delivery-plan/v1:

| Field | Selection |
| --- | --- |
| sources | Named context source editions, each containing path and sha256 of its source manifest |
| scenario_runs | Named completed future land-cover run IDs from the retained workspace |
| comparison_runs | Optional additional named completed comparison run IDs |
| delivery | Existing seven-map delivery selection with baseline_run_id and scenario_run_ids omitted |

A source choice inside delivery uses source_id and source_alias. The reserved alias model means the retained scientific core. Additional aliases refer to the selected sources map. Layer, where, id_field and the existing source-selection metadata continue unchanged.

The delivery must retain source_roles for PROTECTED_LANDS, PARCEL, NHD and NWI, and overlays for drinking_water and high_quality_waters. Optional protected_lands/parcels overlays retain their original behavior. Include the responsible metadata contact, cartographic settings and any requested priority settings. The original SDR terrain calculation supplies LS_FACTOR.

    python -B -m model.regional_job finish \
      --core-result /owned/core-result.json \
      --plan /owned/delivery-plan.json \
      --output /owned/native-receiving.json \
      --build

Finish imports only its new context source editions, compares the existing selected runs and optionally builds the existing seven-map delivery. It contains no native model execution call. The full seven-family path requires completed combined NDR/SDR baseline and scenario runs on the same grid; NDR-only and SDR-only core results remain separately usable scientific results.

The output keeps schema upstate.native-model-receiving/v1 and the fields already consumed by operator/receiving.py. It also records source_collections by alias and the original core_selection_id. The output can be passed directly to the existing operator receiver with its actual Node, Playwright and Chromium paths. The operator's existing delivery build reuses the completed selected delivery.

## Recovery and identity

Both phases use the Workspace's existing .native-model-batch.lock so they cannot write concurrently with the original full native_batch operation. Each source manifest is bound to its exact bytes and SHA256 before import. The manifest hash is checked against the retained collection. Future context is assigned its own collection identity and cannot overwrite the core alias.

The original Workspace importer retains exact source bodies and companions. Original upstream geometry, native soil and climate resolution, parameter provenance, output units, structural stream omissions and per-hectare-to-pixel conversions continue through the same maintained code.

## Execute the actual land-cover alternatives

The additive `model/regional_scenarios.py` runner starts the scientific alternatives against an already completed core. It retains that core's exact grid, parameter profile and selected native models. Newly acquired change-mask sources are separate immutable collections, so they do not change the original scientific grid or repeat the baseline run.

Save a plan with schema `upstate.regional-scenarios-plan/v1`. Its `sources` object uses the same named manifest selections (`path` and exact `sha256`) as delivery context. It may be empty when the selected mask sources already belong to the core. Its nonempty `scenarios` object maps descriptive names to original Workspace land-cover scenario definitions. Each definition contains `title`, `reason`, `kind: "landcover"` and the explicit `patches` list. The optional `source_alias` selects one of those named mask editions; the default `model` selects the core's original collection. A patch selects the retained `mask_source_id`, actual source layer/filter if needed, existing `from_codes`, destination `to_code` and its reason. The native implementation retains the actual changed-cell counts.

Run all named alternatives with the equipped environment:

```sh
python -B -m model.regional_scenarios \
  --core-result "$UPSTATE_CORE_RESULT" \
  --plan "$UPSTATE_SCENARIOS_PLAN" \
  --output "$UPSTATE_SCENARIOS_RESULT"
```

The result has schema `upstate.regional-scenarios-result/v1`. Its `scenario_runs` object supplies the completed name-to-run-ID mapping used by `regional_job finish`; `comparison_id` identifies the model-specific comparison against the original baseline. It also retains the scenario IDs, mask source collections, original core-result SHA256, and native outputs. For the complete seven-family delivery, select the combined NDR/SDR core and its completed alternatives. NDR-only and SDR-only runs each use the exact corresponding core and compare within that model selection.

An interrupted execution resumes through the same command. The state under `regional-scenarios/<selection-id>/` records each native run ID before dispatch, and the maintained native engine reuses completed stages. Source preparation and grid generation are inherited from the core.
