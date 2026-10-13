# Selected native models and retained calculation reuse

Operation: UPSTATE-FULL-PRODUCT-BUILD-BRYCE-20261012  
Source owner: 70CB, joined with the ESI-178D regional programme and the maintained Upper Savannah operator.

The current application can calculate NDR, SDR or both from the original scientific source edition. Profile, grid and run selections carry the same native model names. Each completed run keeps the selected original outputs, and the complete map delivery consumes the full NDR and SDR result.

## What each selection needs

| Selection | Prepared physical inputs | Required original table columns | Reporting outputs |
| --- | --- | --- | --- |
| NDR | DEM, NLCD, PRECIPITATION | lucode; load_n/load_p; load_type_n/load_type_p; eff_n/eff_p; crit_len_n/crit_len_p; proportion_subsurface_n | Nitrogen and phosphorus |
| SDR | DEM, NLCD, R_FACTOR, K_FACTOR | lucode, usle_c, usle_p | Sediment |
| NDR + SDR | All five input roles | Both sets above | All three pollutants |

The complete original CSV remains in the source edition, including additional columns. Validation applies to the selected model's required fields and native parameters. All actual land-cover codes in the selected grid must have original coefficient rows.

InVEST remains pinned to 3.20.0. The original NDR source imports SDR as a dependency, so its source identity is checked even when only NDR is executed. Native export densities retain the original mass-per-hectare meaning; the existing 30 m reporting conversion multiplies by 0.09 hectares per pixel. This work keeps the native rate-to-mass function and its original reporting mask.

Official source identities:

- [Native NDR source](https://github.com/natcap/invest/blob/3.20.0/src/natcap/invest/ndr/ndr.py), Git blob f518b2867d4a327675fcb1c9b4ba56f29b12188d.
- [Native SDR source](https://github.com/natcap/invest/blob/3.20.0/src/natcap/invest/sdr/sdr.py), Git blob 0cac27add172011df367ff8026427dbbdbcda5b2.
- [Regional selected-model API and orchestration](https://github.com/woahwhattheheck/public-commons-sprint-2026/tree/8174e0503c6429cec6086eca37bb757e79c6c1e8/opportunities/upstate_forever_2026).
- Original 72-file engine: Commons 7c4223a111581935b494d5ac4b9357ef86992d67, [retained complete carrier](https://tokenjunkielabs.slack.com/docs/T0BRETUB5TK/F0C8F3MKR3M).
- [Current 18-file operator/customer/spatial cohort](https://tokenjunkielabs.slack.com/docs/T0BRETUB5TK/F0C8GLD74CT), source ref 97d09111ac34899ea46ba9fdd599cccf5e46dbac.

## Use the existing operator

1. Open Parameter profiles and choose New parameter profile or Revise. Select Native models. Choose the original source edition and biophysical CSV, enter the published references and period, and fill the displayed native parameters. Save the immutable profile.
2. Open Model grids and choose Prepare model grid. Select the same intended model scope, the actual raster source IDs, reporting boundary, hydrologic domain and positive upstream context buffer. Only the selected model's raster controls are required. Prepare the original grid and inspect its dimensions, units and inputs.
3. Open Native model runs and choose Prepare native run. Select the actual prepared grid, profile and scenario. The Native models control offers their common models. Review the prepared selection and start Run. Existing failed runs retain Resume.
4. Open the retained run. The stage table shows actual start/completion times and whether a native stage was calculated in that run or reused from an original run. Annual reporting totals appear only for selected outputs. A model outside the selection is labelled Not selected.
5. Compare completed runs on the same retained grid. The chosen cohort must share NDR, SDR or both. Its saved comparison records the actual common output names. Observation comparison preserves the entire original observation edition and records observations for an unselected model as exclusions.
6. When both models and the actual supporting sources are ready, open Maps and delivery. Its baseline and alternative choices contain complete NDR/SDR results. Continue through the original seven-family map, metadata, report and full archive operation.

The original queued actions remain profile.save, grid.prepare, run.prepare, run.start, run.compare, observation.compare and delivery.build. The existing server forwards the full selected payload to Workspace. The existing customer, spatial, community and other operator modules retain their own queues and writers.

## Extend the original aligned grid

Open an existing complete grid and choose Extend / revise. Keep Reuse original grid preparation selected. Select the additional native model and its actual new raster sources. If the new data is in a later source edition, choose that edition with the same retained original common sources and geometry selections. Keep the reporting/model geometry and buffer unchanged, then prepare the new grid.

The new grid has its own source selection and identity. It retains complete original common files as independent reflinks or copies and prepares additional roles through the maintained aligner. Its reused_inputs records the original grid, paths and hashes; each reused raster input also records its original source collection and source ID. Original model-domain/reporting GeoPackages and reporting mask retain their exact bytes.

A changed geometry, native grid definition or buffer requires a fresh preparation. Clear the reuse choice for that operation. A raster with changed original bytes, native companions, conversion or resampling is prepared again. Merely adding an R or K source does not require redoing unchanged DEM, land cover and precipitation.

API field: set base_grid_id on the new grid spec. The value identifies the original complete grid in the same workspace. An absent field follows the ordinary preparation path.

## Run and stage contracts

The public common API matches the regional source:

- selected_models(value=None): accept a model-name list/tuple or a profile/grid/run-selection dictionary; return the canonical list in ndr, sdr order.
- required_roles(value=None): return the required physical input-role tuple.
- output_models(value=None): map selected reporting names to their original native model and registry ID.
- profiles.inspect_table(path, models=None, *, selected_models=None): both caller spellings use the same selected source-table contract.

Profile and grid model field examples are {"models":["ndr"]} and {"models":["sdr"]}. Selecting both canonicalizes to an omitted models field. An omitted run model choice inherits its selected grid.

The historical full-model run identity is unchanged:

    {
      "schema": "upstate.run-selection/v1",
      "grid_id": "<actual retained grid id>",
      "profile_id": "<actual retained profile id>",
      "scenario_id": "<actual retained scenario id>",
      "invest_version": "3.20.0"
    }

A selected partial run adds only "models":["ndr"] or "models":["sdr"] to that dictionary. Workspace.prepare_run returns its existing SHA-256 identity using common.digest. Programme preview and materialization must use that exact dictionary and canonical omission rule.

Run state remains prepared, running, failed or complete. Native stage names remain ndr and sdr; landcover remains the optional original scenario-raster stage. Existing stage.arguments, stage.files, stage.registry_ids and original output IDs retain their contracts. New stage metadata is additive:

- input_signature: id and full selected input/runtime description.
- runtime: the actual execution environment of this original stage.
- companions: complete retained native sidecars, including Shapefile components, raster masks, overviews, auxiliary and world files, CSV type declarations, and SQLite journal files when present.
- registry_outputs and additional_files: original native return values and directory members, including nested files and empty directories, under their original model paths.
- reused_from: original run ID, model, completion time, input signature and original argument descriptor.
- reuse_started_at, reused_at and transfer: the retained transfer interval, file and byte totals, and actual copy methods.
- requested_arguments: the new requesting run's argument file.

For a reused stage, stage.arguments is the original executed argument body. requested_arguments describes the new run's requested paths. Its native registry IDs and output file bytes remain original.

The model_scope field exposes selected_models, native_stages_complete, completed_models, omitted_models, expected_artifacts, available_artifacts, selected_models_complete and full_model_outputs. native_stages_complete describes finished native engine calls. completed_models additionally requires their reporting artifacts. A complete run requires all its selected stages and reporting outputs.

Expected artifact names remain:

- NDR: nitrogen_export and phosphorus_export.
- SDR: sediment_export.
- Both: all three.

Full seven-family delivery requires full_model_outputs. A completed partial run remains useful for its selected native outputs, comparisons, observation analysis and later exact stage reuse.

## How original stage reuse works

A completed native stage is indexed under stage-cache in the same retained workspace. The key contains the model's relevant input bodies, complete original biophysical table, actual native arguments, official model module identities, and the recorded runtime package/environment versions. Output directory paths, worker scheduling, and the other model's unused parameters are excluded from that key. The native result suffix remains part of the identity.

The already-verified grid inputs and original table supply the stage signature without rereading the large raster bodies. Actual native input masks, auxiliary files and Shapefile companions also enter that identity. Grid extension retains any such original raster companions alongside the reused main file. Native stages from older installations without an execution-time input signature retain ordinary original-run reopening and continuation.

A later run first looks for a completed stage with that exact key. A lock for that input signature gives one producer the native calculation; a waiting run checks the completed stage again when it obtains the lock. Reuse verifies the original argument body and transfers the retained outputs, complete directory members and native sidecars under the new run. Each destination is an independently owned reflink where the filesystem supports one, or an independently copied file; a previous hardlink is replaced with an independent file. The transfer verifies actual bytes against the original expected size and hash and installs each completed file atomically. It keeps the original argument body, source run and transfer details in the stage record.

A surviving native stage from a run that failed later can be reused. For example, a complete NDR stage can be retained before SDR or later reporting finishes. The receiving run still generates its reporting artifacts through the original reporting-mask/unit conversion.

To extend a nutrient-only study to full delivery, prepare the full grid using its original base_grid_id, then select the actual full profile and scenario. A matching NDR stage is reused; SDR executes against its actual R/K inputs. The result is an ordinary full-model run on the full grid. Full baseline and alternatives can then enter the existing delivery operation.

New runtime or relevant source/table/parameter identities produce a different stage key and a new calculation. A native candidate whose retained files cannot be read is recorded in reuse_observations, and the current calculation follows its own original execution path.

## Combine previously completed NDR and SDR runs

The explicit assembly operation selects the two actual original run IDs. It prepares the ordinary combined run, compares each original model's source and parameter inputs against that selection, retains the complete original native stages and finishes the normal reporting outputs. The resulting full run appears in the existing operator, comparisons, scenario programme and seven-family delivery selectors.

Prepare the combined grid and full profile in the existing Workspace. The full profile selects one retained original biophysical CSV with all required NDR and SDR fields. Use its original table bytes for the selected component runs as well. Extend an existing grid with base_grid_id when adding precipitation or R/K sources; common original preparations then stay byte-identical.

The callable contract is:

    combined = workspace.combine_runs(
        {"grid_id": actual_full_grid_id,
         "profile_id": actual_full_profile_id,
         "scenario_id": actual_scenario_id},
        {"ndr": actual_completed_ndr_run_id,
         "sdr": actual_completed_sdr_run_id},
    )

Both models are implicit in the combined selection, preserving the full-run ID convention. combine_runs returns the ordinary completed run. Its selection contains the actual grid_id/profile_id/scenario_id for the regional consumer. Each adopted stage keeps reused_from.run_id, its original arguments, any previous reuse chain and its original runtime. The assembly record contains the chosen original run IDs and the actual source-to-target input matches. The existing native run lock and writer serialize adoption and continuation.

The source stages may be from two different runs or from one original combined run. A completed model stage inside a run that failed later is also usable. Earlier executions without the newer automatic-cache input_signature can enter this explicit operation: the assembly uses their retained source records, original argument file, actual files and recorded published native implementation. It retains their original runtime information exactly.

The optional execute=False keyword seeds the original complete native stages and returns the prepared full run. A later workspace.run(combined["id"]) finishes its ordinary reporting outputs. The default completes that continuation immediately.

For a native operator, save the real selection and run IDs as two JSON documents:

    {
      "grid_id": "ACTUAL_FULL_GRID_ID",
      "profile_id": "ACTUAL_FULL_PROFILE_ID",
      "scenario_id": "ACTUAL_SCENARIO_ID"
    }

    {
      "ndr": "ACTUAL_COMPLETED_NDR_RUN_ID",
      "sdr": "ACTUAL_COMPLETED_SDR_RUN_ID"
    }

Then run the installed source:

    python -B -m model.run_assembly --workspace WORKSPACE \
      --selection COMBINED_SELECTION_JSON --source-runs ORIGINAL_RUN_IDS_JSON \
      --output COMBINED_RUN_JSON

The command returns the complete original run record, including all native outputs and input matches. Repeating the same completed selection reopens its existing full run.

### What the join compares

The shared native_arguments.py mapping is used by both ordinary execution and assembly. Assembly compares the actual parameter values, physical grid definition, scenario source selections, prepared DEM and land cover, full original biophysical table, model domain, reporting mask, and the relevant precipitation or R/K inputs. It verifies the original argument file against the saved source run. When an original archive has been moved, it remaps only the common original workspace prefix inferred from that run's recorded workspace_dir; every native input must still select the corresponding retained original path.

Matching file bodies and companions take the direct reuse path. For differing GeoTIFF encodings, the fallback reads every cell and mask in fixed windows and compares exact native headers and unrounded value bytes. For differing model-domain container metadata, the vector fallback compares every ordered layer, schema, feature ID, attribute and coordinate. These are complete native-data comparisons. The original source files and their distinct body hashes remain recorded alongside the match. Table bytes and declared physical units must match.

The operation retains original land-cover scenario preparation and its companions when needed. It checks every selected file and directory path before installing files, preserves already completed target stages, and transfers the complete original registry members and sidecars as independent reflinks or copies. Empty returned directories are retained. It writes each adopted stage into the same run as soon as all of that stage's original files are present. An interrupted transfer replaces only its unfinished planned files atomically when the same run resumes. The native report conversion then derives the three actual reporting rasters through the selected reporting mask; its adopted engines are already complete.

The automatic cache remains the strict execution-signature route described above. Explicit assembly is an operator's selection of actual completed stages and records that choice independently. Its use does not manufacture a historical execution signature.

### Regional delivery consumer

The regional finish path consumes this combined run's actual IDs and full source selection. It can call workspace.combine_runs directly for the baseline and each already completed paired scenario. Preserve those results as ordinary full-model native runs on the common full grid, then use the regional consumer's original core-result and finish-plan writers. The combined run's assembly and per-stage origins carry both original component run IDs into the saved Workspace and portable archive.

7F24's complete raster source is included here: rasters.py, raster_stats.py and GRID.md retain its exact windowed statistics and resumable alignment. Workspace.prepare_grid supplies its original source body/companion identity and removes rebuildable alignment tiles only after the complete hashed TIFF has been recorded. Its separate current regional_job.py/regional_scenarios.py/scenario_summary.py continuation remains with the regional producer.

## CLI, regional jobs and compute programmes

Existing model.cli commands accept the selected JSON documents directly:

    python -B -m model.cli --workspace WORKSPACE profile-save PROFILE_JSON
    python -B -m model.cli --workspace WORKSPACE grid-prepare GRID_JSON
    python -B -m model.cli --workspace WORKSPACE run-prepare RUN_SELECTION_JSON
    python -B -m model.cli --workspace WORKSPACE run ACTUAL_RUN_ID
    python -B -m model.cli --workspace WORKSPACE run-inspect ACTUAL_RUN_ID

Use the actual existing CLI help if the cumulative receiver has added subcommands. The JSON fields above and the Workspace methods are the stable integration contract.

ESI-178D regional_job.py and regional_scenarios.py import the common selected-model functions preserved here. They retain their original core source manifest, grid/profile/baseline IDs and late context delivery. Its climate_region.py keeps precipitation ready independently of R-factor arrival.

A73C ComputeProgrammes can forward optional models per materialized run. Its preview must inherit absent selection from the chosen grid and canonicalize full scope to the historical dictionary above. The original native run IDs, stage maps, artifacts and changed profile/scenario identity remain the programme's progress and result sources.

ES-EXP experiment iteration and ES-ASTRA-S1 selected-pollutant reporting consume those ordinary retained runs. They can inspect stage.reused_from to attribute saved calculation time while keeping original execution timestamps.

## Saved delivery and independent reopening

The original portable archive includes model, operator, source_tools, source, original source objects, grids, runs, comparisons and stage-cache records. Complete backups retain native intermediate files and all stage companions. The receiving path regenerates source views from retained original objects and validates the same grid/run IDs and completed reporting artifacts.

Carry this code with the current whole application. A backup created with native intermediates excluded can still reopen its retained final outputs; stage reuse requires the original declared native files to be available. The default complete archive contains them.

Native receiving belongs in the existing equipped application and scientific Workspace. Use the original accepted model case or the current regional source operation; keep its actual source IDs and process/run selection. Exercise profile/grid/model selection, native completion or genuine existing-stage reuse, visible operator review, comparison, full archive and independent reopen in that same operation. Return the actual outputs and any concrete integration exception into the original Upper Savannah thread so source corrections join the same product.

## Publisher-native grid resolution

The current 7F24 native-resolution source is composed into this package as well. An omitted grid_spec.resolution_m preserves Upper Savannah's original 30-metre operation and historical selection. An explicit resolution_m retains a different original publisher-native grid when that separate scientific programme selects it. Output placement uses the selected affine and actual determinant for cell area. Grid extension and completed-stage assembly require the same actual original physical grid; they preserve that field through the normal selection. The source reference for this addition is F0C8N1N4VF0, alongside the exact raster preparation in F0C8JK0F745.


## Select completed models in the existing operator

Open **Native model runs** and prepare a combined NDR + SDR selection using the retained full grid, parameter profile, and land-cover scenario. Once the workspace contains completed native NDR and SDR stages, the prepared run offers **Use completed models** in its row and detail view.

The form shows the target grid, profile, scenario, and run identity. Select **Original completed NDR run** and **Original completed SDR run**. Each choice retains the source's actual scenario, grid, parameters, and completion time in the form. A completed run containing both models can supply both choices. A model that finished before another stage failed can also supply its completed outputs.

Choose **Use results and complete run**. This submits the existing `run.start` action with this payload:

```json
{
  "run_id": "the original prepared combined run ID",
  "source_runs": {
    "ndr": "the selected original completed NDR run ID",
    "sdr": "the selected original completed SDR run ID"
  }
}
```

These strings stand for the actual retained run IDs chosen in the form. The ordinary browser action supplies the existing operation identity and opens its original task.

The original native retention entrypoint checks its existing task and attempt first. A retained result is restored through that same attempt. Otherwise it seeds the selected completed stages into the prepared run, freezes its original inputs, and calls the original Workspace.run path. The adopted models keep their full outputs, companions, argument bodies, runtime records, and source IDs. The normal execution completes the combined reporting rasters.

The completed run's **Original completed models** table shows the original run, grid, parameters, and matched input count. A source run retained in the same workspace can be opened directly. When an independently restored result carries the original stage without its source run record, that table retains the source identity and directs review through the original stage data already present in the result.

The saved native result includes actual prepared grid companions and the original source editions identified by reused inputs. Its original request retains both selected source run IDs. Existing task retry, cancellation before start, native-result reopening, and complete Workspace backup continue through their maintained routes.

### Compact workspace state and completed native stages

The live workspace state carries each run's native completion times and retained file counts in `stage_summary`. Opening a run returns its complete `stages` records. The completed-model form accepts both shapes and ranks candidate sources by the target scenario, grid and profile, then their original completion time.

Only a stage with its original completion timestamp and retained files enters the choices. A failed run can supply a model that completed before its other work failed. Running and queued runs remain outside those choices. The final native operation checks the selected actual files, model parameters, runtime and source lineage before adopting the stages.

The full-delivery picker reads the same completed stages and requires retained nitrogen, phosphorus and sediment exports from a complete combined selection. NDR-only and SDR-only runs keep their independent selections and reporting outputs.

### Continue a failed input match

Read the error on the original task. The comparison identifies the exact input or parameter that differs. Reopen the prepared run and select source stages matching its actual grid, scenario changes, original biophysical table, and selected native parameters. Retain the original failed task and source runs alongside the new explicit selection.

### Compose the current application

Receive the complete current selected-model bank first, then this operator continuation, followed by the maintained ECSA typed-preview/programme host and its current installers. This continuation changes the existing browser host and native retention entrypoint. Its exact source joins preserve later additions in those files when the receiver already contains them. In JavaScript, apply replacement bodies through a callback, `body.replace(before, () => after)`, so literal source dollar characters are retained.

## Shared cache and completed-model receiving

The complete shared-cache composition extends the current selected-model engine and completed-model assembly together. Its six full files retain the existing factored native argument builder, the selected NDR/SDR stage loop, original Workspace identity and the current operator's `run.start` route. The maintained ES-EXP cache supplies the independent-copy primitive, complete native registry snapshot and signature-scoped producer lock. The completed-model assembler uses that same copy primitive and preserves all recorded native directory members.

Receive the full current application, the current selected-model layer, and the original-operator layer before this shared-cache layer. Keep current author-owned extension installers and the ECSA typed-preview/programme host in the cumulative application. When a shared source already contains newer owner changes, use the supplied exact component joins against their stated source bodies; the source bank also includes every complete postimage. Continue the existing workspace and its original prepared run.

`SHARED_STAGE_REUSE.md` retains the originating ES-EXP component's detailed cache and transfer contract. This completed composition supplies the current receiving order and the matching factored engine and completed-model assembler.

## Complete native runtime in the public application

The application ships the complete `ecsa_runs` runtime beside `model` and `operator`. The original operator's `run.start` branch enters `invoke_original_run` inside its existing task. The same task request contains any selected original NDR/SDR run IDs; the retained result stays bound to its original task and attempt.

The completed native tree records all actual run files and original directories. Its receiving path recreates nested and empty directories as well as the original file bodies. File-only native trees from earlier editions keep their existing representation. Current directory-aware trees use the same native tree schema with an additional explicit `directories` member. Existing-file repair checks every selected file and required directory before installing missing files, preserving an existing different file as a visible conflict in that original receive.

### Retaining repeated source and model files

The original operator freezes the selected input files before it executes a native run and retains the completed run before it records task success. The existing source, grid, native-stage and reporting-file descriptors supply each known file's exact byte length and SHA-256.

When that body is already retained, the store reads and checks the actual selected file and the retained body, then reuses the immutable body directly. It allocates no full temporary copy for that known duplicate. A new file follows the existing streaming capture path and is published only after its original length, digest and stable file identity agree. This reduces temporary disk demand when a programme reuses the same source grids or adopts completed native stages.

The task, attempt, original run and saved native-tree identities remain the same. Complete source files, native files and directories remain available through the original receiving operation. Files without an existing descriptor still use complete streaming capture, so the full native run tree remains retained alongside the described outputs.
