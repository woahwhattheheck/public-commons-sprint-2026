# Gura native source-class comparison continuation

This continuation starts from the original `receive_gura.py` `receiving.json` and carries that same study through ordinary Workspace scenarios, native InVEST 3.20.0 runs, the S1 watershed report, and the economic decision desk.

## What the comparison means

The default plan pairs the most common class in the original reporting-mask cells with each other observed class, in both directions. Each pair is a separate complete land-cover scenario. It reads every class name and coefficient row from the retained original tables, and records the native watershed feature IDs and actual class areas. Where an original table supplies no class name, the display uses its numeric native class code.

The resulting titles say **source-class counterfactual exploration**. The purpose is to explore the original model's response to exact class substitutions. Restoration, protection, farming or other management meanings require a separate source-defined scenario design. The original coefficient profile, grid, baseline and routing parameters remain paired throughout this comparison.

## Use the existing native intake

Use the complete accepted application under `opportunities/upstate_forever_2026/` in [woahwhattheheck/public-commons-sprint-2026](https://github.com/woahwhattheheck/public-commons-sprint-2026/tree/main/opportunities/upstate_forever_2026). The published cumulative application includes the core workbench (PR2672), S1 reports (PR2692), and the complete native-to-economic/browser continuation (PR2689). Record the actual source commit installed by the receiving worker. An already issued native child keeps its original scientific source and saved programme/run IDs while it finishes.

The maintained streaming intake is `source_tools/receive_gura.py`: 22,545 bytes, SHA-256 `474e2dee21f878bac64c4cd513fdc5898ce8cc771aa027e74fd71388a662ecdc`. It validates already retained ZIP members through EOF and checks their CRC/SHA without creating another staged copy. It preserves the existing receiving record, source collection, grid, profile and baseline identities. Use it with the current accepted Workspace and raster modules from the same cumulative application.

For an active operation, take its actual interpreter, application, receiving record and input paths from the worker's retained command. The current GURA-NATIVE-01 receiver joined with `/workspace/scratch/6334452a9245/eco-science/gis-env/bin/python` and retained inputs under `/dev/shm/c8ff-upstate-planning-20261013/gura-3.20.0-inputs`. Earlier `/mnt/data` and `/opt/pyvenv` examples identify a prior equipped receiver; the command's own paths determine which operation is resumed.

The same application also needs the current original `ComputeProgrammes` producer and CLI already used by the Gura receiver. The continuation invokes the observed ordinary command `model.compute_programme_cli --workspace WORKSPACE resume PROGRAMME_ID`. It creates a new comparison programme that reuses the original baseline run and records the original intake programme ID. Completed run IDs are reused on restart.

The selected Gura model grid uses nominal 300 m cells, so a full cell occupies 9 ha. The current grid builder reads the original land-cover CRS and upper-left anchor, projects the retained watershed into that CRS, and snaps the model extent relative to that same anchor. It requires projected metre coordinates and a north-up, unrotated source. Where nominal pixel coefficients need normalization, `grid.reference_normalization` retains the original and model transforms, model window and `maximum_reference_corner_shift_m`. This distinguishes the original source geometry from the explicit model grid while keeping the same model grid across the baseline and alternatives. Native NDR export rates are kg/ha/year; native SDR export rates are metric tonnes/ha/year. The existing original producer converts rates using the actual affine cell area once. Its annual watershed masses enter the economic companion directly.

## Prepare and run the actual comparison

From the existing application directory, select the real retained receiving record and a new plan filename. In these commands, `python` means that operation's actual accepted GIS/InVEST interpreter; the uppercase arguments are placeholders for its retained local paths.

```bash
python -B -m source_tools.gura_comparison catalog --receiving RECEIVING_JSON --output CLASS_CATALOG_JSON
python -B -m source_tools.gura_comparison plan --receiving RECEIVING_JSON --output CLASS_PLAN_JSON
python -B -m source_tools.gura_comparison execute --receiving RECEIVING_JSON --plan CLASS_PLAN_JSON --output COMPARISON_RESULT_JSON --workspace-backup WORKSPACE_ARCHIVE_ZIP
```

The plan command prints and saves the actual selected class pairs, exact original labels, original source rows, observed cell counts, native areas, profile, grid, watershed IDs and source hashes. For explicitly chosen original pairs, repeat `--convert FROM:TO` on the plan command. A source class must have cells in the retained reporting area; a target class must have an original profile row. The default completes the broad observed-class comparison automatically.

The execution command saves its plan and programme selection under the original Workspace's `gura-comparisons/OPERATION_ID/`. It records both the controlling worker and the native child process, their host, interpreter, command, timestamps and IDs. The native stdout/stderr remains in `native-programme.log`. If the existing job is already running, continue with its owner and retained programme rather than starting another copy.

After native completion, the command reads the actual `landcover.edits` cell counts and areas, builds one original S1 cohort across the saved baseline and alternatives, and exports an economic desk for each explicitly retained Gura watershed feature with common native output support. Each export includes the original source report text and a complete `decision-package.zip`. The result gives every original zone ID, report path, baseline/alternative run ID and export directory.

The optional Workspace archive must be outside the Workspace. On restart an existing archive is reused when its saved completion identity, path, byte count and SHA-256 match. If archive creation finished just before its record was saved, the continuation verifies the original archive manifest and all member hashes, the full native-cache/delivery selection, and this operation's source identity, completed result and native report before recovering that missing record. Repeating the same command reuses the selected native runs and retained report editions. If the economic source is still being installed, `--physical-only` completes the original native watershed report; rerunning the default command creates the full economic editions from those same completed runs.

## Complete the operator journey on that result

Use the economic edition's retained `selection.json` with the original S1 `decision.json` or `report.json` and its exact matching zone ID:

```bash
python -B -m model.decision_receive --scenario-report SCENARIO_DECISION_JSON --zone-id ORIGINAL_ZONE_ID --selection ECONOMIC_SELECTION_JSON --output NEW_OPERATOR_RECEIVE_DIRECTORY --browser-executable /usr/bin/chromium
```

The existing receiving command opens the real desk, selects an available modeled axis and scenario, saves the case, reopens it, and retains the resulting browser outputs and timings. Return its result or first actual traceback to the existing GURA-NATIVE-01 thread with the original programme/run IDs so the same owners can finish any integration correction.

All initial cost entries are unentered. A later implementation estimate belongs to its named scenario and defined footprint; a selected-zone estimate stays attached to its original report and zone. Keep the Gura study title in the operator and exports. Regional Upper Savannah estimates and South Carolina assistance-payment schedules retain their own study and funding context.

## Current source and attempt recovery

Native continuations use the maintained CLI `resume` action, including the
first launch, so an earlier retained pause can clear. New command and attempt
records are kept below
`gura-comparisons/<operation-id>/programme-executions/<programme-id>/`.
Older command ledgers remain retained and their matching active child can be
observed before another process is issued.

If an inactive incomplete programme names a changed scientific source
inventory, its saved selection first reconnects a retained programme with
matching native bindings and the current scientific source. An active compatible
programme is observed through its existing command and locks. A new programme
is created only when no such retained programme exists, preserving canonical
native run identities. The original receiving record
and comparison-plan bytes stay intact. Completed programmes and reports keep
their original provenance and are reused after verification.

The workflow and standalone comparison default the inherited GDAL block cache
to 16 MB and GDAL threads to one before native execution. Explicit environment
settings take precedence and are recorded in the issued command.

When a report producer changes after a partial economic export, its new outcome
is retained under the original zone's `editions/<outcome-id>` directory. The
previous completed economic edition remains intact. Reopening verifies the
original zone, report identity, manifest members and associated package ZIP.


## Original study context through reports and client delivery

New automatic watershed reports retain `delivery_mode: native_study` before the report identity is calculated. The early reference report and full comparison use the saved plan’s exact `study`, `purpose` and `source_reference`; the native-study release driver shares its existing explicit original-study declaration with its newly built source report. The baseline, ordered alternatives, original reporting/model grid, native output units and watershed selections remain those of the retained operation.

Open the saved report in **Watershed reports**, then use **Economic desk** for its original reporting zone. **Prepare client report** carries that report’s study mode and original title, purpose and reference into the atlas alongside the exact report and economic-edition identities. The report’s **Map release** selector also displays the saved mode. A reference-only report retains its original annual totals; a map release still requires the completed baseline and explicit land-cover alternatives supported by the selected native engines.

The comparison keeps its original `report-selection.json`. Each current request is also retained under `report-selections/<selection-sha256>.json` and named by `progress.json.report_selection`. A partially completed pre-context operation verifies the same physical cohort and watershed selection before retaining the enriched request, so it can continue its existing native runs. Completed reports and economic editions remain available with their original identities. For an older report without a saved delivery context, choose **Original native study** in its Map release or atlas controls and enter the actual original study purpose before building.
