# ECO13 scenario workbench on the current native Workspace

This integration brings the preserved ECO13 workbench onto the existing Upper Savannah scientific Workspace and its pinned InVEST 3.20.0 NDR/SDR implementation. It retains the workbench's matched jobs, cost/Pareto comparisons, grayscale report, CSV/JSON outputs, and portable report export.

Use this entrypoint for the current Ecosystem Sciences product. Existing stand-alone ECO13 plans retain their original declared engine version and bindings. The integration reads the current Workspace selection and its original native output registry.

## Install into the assembled source

The complete current package is installed under:

    integrations/eco13_scenario_lab/

The Workspace entrypoint consists of these leaves within that complete package:

- eco_scenario_lab/workspace_driver.py
- eco_scenario_lab/workspace_cli.py
- WORKSPACE.md
- examples/workspace-selection.template.json
- examples/workspace-runs.template.json

Install the complete current source package, including current ECO13 0.1.2, the Workspace bridge and the retention integration. The complete carrier preserves original files omitted by the upstream 17-file upgrade and supplies all maintained postimages and Workspace/storage additions. The model package remains the assembled application's current model/ package. The bridge imports its existing Workspace, common, profiles, native and rasters modules directly. [RETENTION.md](RETENTION.md) describes input copying, complete native objects and portable receiving; [UPSTATE_RECEIVING.md](UPSTATE_RECEIVING.md) documents the current original Workspace experiment route; [EXPERIMENT_INTAKE.md](EXPERIMENT_INTAKE.md) retains the legacy NativeJobsEngine inspection route.

Run from the assembled application root, with its existing equipped interpreter:

    PYTHONPATH=".:integrations/eco13_scenario_lab" /opt/pyvenv/bin/python \
      -m eco_scenario_lab.workspace_cli --help

The underlying package requires Python 3.11+, NumPy, Rasterio, Fiona, Shapely 2 and PyProj. New native model runs use the existing Workspace's pinned natcap.invest 3.20.0 installation. Completed Workspace runs pass through the original reuse path.

## Fast receiving path: adopt accepted native runs

Use examples/workspace-runs.template.json for a completed baseline and one or more completed alternatives. Replace the visible SET_ACTUAL_* markers with the retained run IDs. Set cost_cents to a declared estimate or quote in minor currency units when one is available; null means unpriced. Scientific planning, native execution and table reporting work with unpriced alternatives. Cost/Pareto ranking uses declared costs, so an unpriced intervention never enters the budget screen as free.

The completed runs must share their retained grid, profile and selected models. Their original scenario IDs, grid ID, profile ID and model selection are recovered automatically. The baseline scenario must be the retained baseline, and alternatives must be land-cover scenarios.

    PYTHONPATH=".:integrations/eco13_scenario_lab" /opt/pyvenv/bin/python \
      -m eco_scenario_lab.workspace_cli adopt \
      accepted-runs.json /mnt/data/eco-native-scenarios \
      --model-workspace /mnt/data/current-scientific-workspace

The planner retains the inputs and selected source metadata, reuses the completed native land-cover stage when available, and creates the workbench plan. Existing full NDR/SDR selections keep their original content-addressed run IDs, including the original omitted/full-model normalization.

Complete the table report and original reporting-mask raster comparison:

    PYTHONPATH=".:integrations/eco13_scenario_lab" /opt/pyvenv/bin/python \
      -m eco_scenario_lab.workspace_cli run \
      /mnt/data/eco-native-scenarios \
      --model-workspace /mnt/data/current-scientific-workspace

The existing Workspace run lifecycle handles reuse. The first workbench job for a case/scenario invokes that selection; a selection containing both models completes NDR and SDR together. Its second workbench model job uses the same completed native run.

The useful receiving outcome is the actual native run IDs in the command response, complete job counts, the opened report, and the retained stage tables. The bridge itself creates these artifacts during normal operation.

## Plan new alternatives and sensitivity cases

Use examples/workspace-selection.template.json to select:

- An existing retained grid and default parameter profile.
- The baseline scenario.
- One or more retained land-cover scenarios with declared costs or null for unpriced alternatives.
- The selected models, NDR and/or SDR.
- One or more matched parameter/forcing cases.

    PYTHONPATH=".:integrations/eco13_scenario_lab" /opt/pyvenv/bin/python \
      -m eco_scenario_lab.workspace_cli plan \
      workspace-selection.json /mnt/data/eco-new-scenarios \
      --model-workspace /mnt/data/current-scientific-workspace

Each case may select its own profile_id. A case may instead provide profile containing an explicit new title, source references, and the NDR/SDR parameter changes. The bridge merges those changes into the declared default profile and calls Workspace.save_profile, which applies the original parameter and biophysical-table validation. Source collection and biophysical table selection may also be revised through that profile object.

Each alternative may select scenario_id or provide a complete scenario object for Workspace.save_scenario. That object uses the original source_collection_id, kind, title, reason and patches. Every patch retains its mask_source_id, optional layer/where, from_codes, to_code and reason. Baselines similarly select an existing baseline scenario or provide the original baseline scenario object.

This preserves the original model's centre sampling and declared patch order. Overlapping patches are applied sequentially to the current cell values, exactly as model.rasters.make_scenario specifies. The bridge retains each patch's source dataset and the native edit counts.

A sensitivity case may select a different retained grid_id for changed forcing. The bridge verifies that its baseline integer land cover, raster lattice, valid support, model-domain geometry and domain IDs match the first case. It then freezes the actual case-specific DEM/precipitation/erosivity/erodibility inputs. Baseline and alternatives within that case share the same retained grid ID and parameter profile.

The destination land-cover codes must exist in every selected case's biophysical table. Prepared alternatives are created before the new workbench directory becomes available.

## Native result binding

| Model | Native registry ID | Native table binding | ID field | Metric field | Report unit |
|---|---|---|---|---|---|
| NDR | watershed_results_ndr | watershed_results_ndr.gpkg | id | n_total_export | kg/year |
| NDR | watershed_results_ndr | watershed_results_ndr.gpkg | id | p_surface_export | kg/year |
| SDR | watershed_results_sdr | watershed_results_sdr.shp | id | sed_export | metric_tonne/year |

The runtime registry selects the source table path. The filenames above are the workbench's retained destination binding. The adapter verifies the retained stage's argument file and primary result artifact and copies the complete result family. A Shapefile includes its .shp, .shx, .dbf and .prj members, plus present companion files.

The current Workspace creates model_domain.gpkg with id and title attributes and passes that vector to InVEST as watersheds_path. Its ID field is id, rather than the stand-alone workbench's ws_id default. The result reader checks the actual output fields and unique domain IDs.

These vector metrics are already watershed totals. They are summed annual mass in the original native model domain. No pixel-area factor is applied to them. The original Workspace's derived rasters and comparison rasters use its reporting mask; those are retained separately in reports/workspace-bindings.json and the existing native Workspace comparison.

A single dissolved model-domain vector does not become the original 217 HUC polygons. The native watershed table and the S1 regional zonal report have separate spatial supports. Use the existing S1 report for the original reporting polygons.

## Execution binding and reuse

Each callback resolves the currently running workbench attempt to its exact case/scenario/model record. This retains distinct alternative identities even when two alternatives have identical prepared raster values.

Before invoking the native selection, the adapter compares the actual workbench scientific arguments to the retained grid/profile inputs. File identity includes dataset companions. The original Workspace prepares and runs the content-addressed selection.

After the native run completes, the bridge verifies the stage's current requested arguments against the workbench parameters and retained input datasets. A directly executed stage uses its original argument file for that check. A reused stage retains both its original executed argument file and the distinct current request. The adapter verifies the self-digest of any retained native stage input signature, verifies every nested reuse record against the preserved original argument body, and recovers the actual execution run from the complete ancestry. It preserves the native completed-stage assembly's per-input matches, source/target identities and exact cell/mask or feature/attribute evidence. This accepts the current native core's completed stages when their file encodings differ but their native data match, including earlier complete stages without a cache signature. The original source run's input paths need not remain available after a complete receiving copy; its authenticated argument bytes, runtime, signature and ancestry remain in the workbench.

The bridge compares the prepared and current native LULC rasters by exact grid, integer cell values and valid support. Compression, tiling, file location and irrelevant NoData payload bytes do not change that comparison. The current request still has to match the workbench's actual frozen scientific inputs; the retained original signature describes the native stage's accepted input identity.

This cell comparison is performed in strips sized for regional rasters. Each retained grid is verified once per planning/driver initialization, and repeated input snapshots reuse their retained dataset family when its file metadata is unchanged. Repeated content checks within one invocation also use file metadata and content caches; both models share the same executor instance.

The native runtime record must match InVEST 3.20.0 and the exact official model blob selected by the existing core. Each workbench receipt retains the requested native run ID, original execution run ID, full stage reuse ancestry, both argument-file identities, retained stage input signature and its digest check, model selection, original stage runtime, current run runtime, result registry ID, copied table family and land-cover comparison. Recorded result companions are verified against their retained hashes before copying. Available native logs are copied once per retained run into workspace-runs/.

The engine identity incorporates the current Workspace core source hashes, including the additive model_selection, reuse, stage_cache, native_arguments and run_assembly modules when they are present. A current source update creates a distinct workbench execution identity while the original Workspace continues to resolve and reuse its own scientific selections. Recorded absolute native argument paths are relocated against the retained model workspace root, allowing the complete model workspace to move.

## Reports, budget comparison and handover

The run command writes the grayscale report and full machine-readable outputs:

- reports/index.html: complete matched native table values and changes.
- reports/comparisons.csv and comparisons.json: all paired model-domain metric records.
- reports/workspace-bindings.json: exact native selections, states and original raster-comparison joins.
- reports/ranking.json: cost/Pareto comparison when explicit objectives are supplied.
- runs/...: original native tables, sidecars, workspace-native-arguments.json, workspace-requested-arguments.json for reused stages, the native run record and execution receipts.
- workspace-runs/.../native.log: available original logs, once per selected native run.
- workspace-context.json: original selected grid/profile/scenario/source-edition metadata.

To rank explicit domain/metric objectives, use the retained id values from the actual table, for example the current model domain's id "1":

    [
      {"watershed_id": "1", "metric": "nitrogen_export"},
      {"watershed_id": "1", "metric": "phosphorus_export"},
      {"watershed_id": "1", "metric": "sediment_export"}
    ]

Save the selected objectives and run with --objectives objectives.json and, if needed, --budget-cents with the declared budget. The original Pareto comparison evaluates complete alternatives across every selected case and includes their declared costs. Case ranges are sensitivity ranges. If requested ranking encounters unpriced alternatives, the command still completes the native work and scientific report, records their IDs in reports/ranking-status.json, and returns exit code 2 for the remaining cost input. With no ranking requested, an otherwise complete unpriced scientific comparison returns 0.

Use --tables-only when the receiving task needs the full native table report without creating the additional reporting-mask difference rasters.

The original workbench export/receive commands remain available:

    PYTHONPATH=".:integrations/eco13_scenario_lab" /opt/pyvenv/bin/python \
      -m eco_scenario_lab.cli export \
      /mnt/data/eco-native-scenarios /mnt/data/eco-native-scenarios.zip

    PYTHONPATH=".:integrations/eco13_scenario_lab" /opt/pyvenv/bin/python \
      -m eco_scenario_lab.cli receive \
      /mnt/data/eco-native-scenarios.zip /mnt/data/received-scenario-report

The report export contains its frozen inputs, scenario preparation, complete copied native tables and reports. Reconnect a received workbench to the delivered original model workspace with --model-workspace on the current integration command. The retained workspace ID must match; its location may change. The existing complete application delivery carries the editable native workspace and model-run artifacts.

For a revised native scenario or case, create a new plan with this integration command. Historical stand-alone workbench revisions continue through their own original entrypoint.

## Source contract and receiving

The complete workbench 0.1.1 with Workspace bridge edition2 was merged in
[PR2750](https://github.com/woahwhattheheck/public-commons-sprint-2026/pull/2750),
commit 77b65a741c84c812ff78a6d7eb63c8e9cd74a974. The current workbench composes
that original bridge with native experiment receiving and independent file
retention. Retain the bridge's recorded version identity when reopening its
existing selections and reports.

The selected-model integration reference is the complete source overlay at
commit 8174e0503c6429cec6086eca37bb757e79c6c1e8:

https://github.com/woahwhattheheck/public-commons-sprint-2026/blob/8174e0503c6429cec6086eca37bb757e79c6c1e8/opportunities/upstate_forever_2026/integration/selected-model-core-overlay.json

Native result identifiers and units follow the original InVEST 3.20 semantics
registry. The reviewed registry source has SHA256
364c0b790b01938b9f77d6fae978a447e9ad8ab0c7258aeeb769a354ba8fc1b6.

Native stage reuse supports both copied original arguments and separately
retained requested_arguments. An original stage signature can predate
companion-bearing signatures, and selected_completed_stage assembly may accept
exact native data in another encoding. Full nested reuse provenance and the
current run's per-model assembly input_matches are preserved.

The reviewed reuse interfaces are model/run_assembly.py, model/native_arguments.py
and model/stage_cache.py. Install this bridge alongside the maintained native
implementation, preserving subsequent changes to those shared modules. On the
receiving host, use the actual accepted native baseline and alternative with the
adopt/run commands above, then open the retained native bindings and comparison
report. Export and independently receive the resulting edition through the same
original Workspace workflow.

<!-- ecosystem-current-work-order:2026-10-13.3:begin -->
## Current native Workspace and demonstration assignment

Carry the complete [current owner brief](../../CURRENT_OWNER_DIRECTION.md), version `2026-10-13.3`, into current provider/cloud/child assignments and onward handoffs. Its full self-contained copy, including the four direct owner instructions, is in [AGENTS.md](AGENTS.md). Original brief Git blob: `8cd1c1f3d371a2fb75471813844e31f489aa8272`.

The actual Upper Savannah simulated native model and connected usable product are the immediate hard priority. Keep actual geographic/source shapes, the 30 m grid, upstream model domain, South Carolina reporting mask and utility focus distinct. The existing execution owner runs the original baseline, realistic riparian restoration and matched control using clearly identified realistic simulated inputs and editable parameters/source editions. Use the actual native InVEST NDR/SDR outputs: annual nitrogen and phosphorus kg/year and sediment tonnes/year delivered to streams, with the matched support, model parameters and source identities retained. Stream loads are not intake concentrations.

Preserve the already-running calculation and one writer per Workspace. This bridge consumes the current owner's exact native selections and completed outputs; existing stage reuse is not permission to duplicate a live programme. Runtime/source existence or another plan is not model execution. Use the current equipped runtime or an isolated actual execution environment through that execution owner when needed, while other builds and source/runtime/archive joins continue.

Tim's team already provides GIS, watershed/environmental modeling, analysis, map/report publishing and natural-capital decision support. Show a specific production workshare it can compare with its own workflow, not a presumed tooling/capacity gap. The prime retains scientific direction, methods, review and the client relationship. Show choose inputs/assumptions → run → inspect maps/tables/differences → revise → hand over an editable package and cold-reopen it. Make speed visible with the actual elapsed run/build/package history; invent neither timings nor a guaranteed reaction.

Open, LOOK at and use the exact outgoing product and ALL attachments as a recipient, including relevant desktop/narrow widths, meaningful states, controls, downloads and extracted archives/working projects. Repair concrete defects directly in the same plain industrial product. Video uses actual app recordings and natural generative TTS where available, followed by viewing/listening to the final export; generated frames cannot pretend execution. Inspection does not replace hard integration or authorize broad suites, review/test theatre or a new controller.

Carry this complete direction onward at the next safe message boundary and return its durable path/version with the next substantive result. No bid/prime-yes gate or arbitrary product/feature cap. Preserve active computations, original source/run/receiver owners, owner-stopped/deleted work, existing attribution/contact/meeting/spend/source controls, no private GitHub/Actions and the October 13, 2026 10:00 a.m. Eastern / 14:00 UTC cutoff. Do not restart or pause work for this propagation.
<!-- ecosystem-current-work-order:end -->
