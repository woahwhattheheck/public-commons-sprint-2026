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

The new grid has its own source selection and identity. It copies or hardlinks complete original common files and prepares additional roles through the maintained aligner. Its reused_inputs records the original grid, paths and hashes; each reused raster input also records its original source collection and source ID. Original model-domain/reporting GeoPackages and reporting mask retain their exact bytes.

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
- companions: retained native Shapefile and raster auxiliary/mask files.
- reused_from: original run ID, model, completion time, input signature and original argument descriptor.
- reused_at and requested_arguments: the later reuse time and new requesting run's argument file.

For a reused stage, stage.arguments is the original executed argument body. requested_arguments describes the new run's requested paths. Its native registry IDs and output file bytes remain original.

The model_scope field exposes selected_models, native_stages_complete, completed_models, omitted_models, expected_artifacts, available_artifacts, selected_models_complete and full_model_outputs. native_stages_complete describes finished native engine calls. completed_models additionally requires their reporting artifacts. A complete run requires all its selected stages and reporting outputs.

Expected artifact names remain:

- NDR: nitrogen_export and phosphorus_export.
- SDR: sediment_export.
- Both: all three.

Full seven-family delivery requires full_model_outputs. A completed partial run remains useful for its selected native outputs, comparisons, observation analysis and later exact stage reuse.

## How original stage reuse works

A completed native stage is indexed under stage-cache in the same retained workspace. The key contains the model's relevant input bodies, complete original biophysical table, actual native arguments, official model module identities, and the recorded runtime package/environment versions. Output directory paths and the other model's unused parameters are excluded from that key.

The already-verified grid inputs and original table supply the stage signature without rereading the large raster bodies. Actual native input masks, auxiliary files and Shapefile companions also enter that identity. Grid extension retains any such original raster companions alongside the reused main file. Native stages from older installations without an execution-time input signature retain ordinary original-run reopening and continuation.

A later run first looks for a completed stage with that exact key. It reads the original stage, verifies its complete retained files, retains native sidecar relationships and links/copies those original files under the new run. It keeps the original argument body and source run in the stage record. The original run, archive IDs and result identities remain intact.

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

The operation retains original land-cover scenario preparation and its companions when needed. It checks all chosen native output paths before installing files, preserves already completed target stages, and writes each adopted stage into the same run as soon as its complete files are present. Interrupted copying can resume that run. The native report conversion then derives the three actual reporting rasters through the selected reporting mask; its adopted engines are already complete.

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
