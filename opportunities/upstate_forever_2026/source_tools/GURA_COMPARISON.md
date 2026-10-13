# Gura native source-class comparison continuation

This continuation starts from the original `receive_gura.py` `receiving.json` and carries that same study through ordinary Workspace scenarios, native InVEST 3.20.0 runs, the S1 watershed report, and the economic decision desk.

## What the comparison means

The default plan pairs the most common class in the original reporting-mask cells with each other observed class, in both directions. Each pair is a separate complete land-cover scenario. It reads every class name and coefficient row from the retained original tables, and records the native watershed feature IDs and actual class areas. Where an original table supplies no class name, the display uses its numeric native class code.

The resulting titles say **source-class counterfactual exploration**. The purpose is to explore the original model's response to exact class substitutions. Restoration, protection, farming or other management meanings require a separate source-defined scenario design. The original coefficient profile, grid, baseline and routing parameters remain paired throughout this comparison.

## Use the existing native intake

Install `source_tools/gura_comparison.py` in the same application used by GURA-NATIVE-01. Keep the current A73C receiver revision 2 and the accepted 7F24 resolution integration. The existing source carriers are:

- Original receiver: F0C8MRTG7C6, `source_tools/receive_gura.py`, 21,851 bytes, SHA-256 `4282b6f65b59c97a94b7f6528615c17a48741a378f42e41db2397d7395e3ed5b`.
- Original-resolution integration: F0C8N1N4VF0. `model/rasters.py` is 28,108 bytes, SHA-256 `c7c24b0f138871bfdfa565d5c080e09733a7d7404e4730c1d29b3f6d1a9a20ed`; `model/workspace.py` is 20,279 bytes, SHA-256 `4479341b3c6d41df4beda084ddbeaa05b9eaa45c9c3baa6202bbf63f15471f14`.
- Original S1 watershed decision producer: F0C8HFSSVKM, current selected-output continuation.
- Economic desk, operator and native receiving command: F0C9JE3M464, the combined 16-file source carrier accepted by the existing ECD1 overlay loader.

The same application also needs the current original `ComputeProgrammes` producer and CLI already used by the Gura receiver. The continuation invokes the observed ordinary command `model.compute_programme_cli --workspace WORKSPACE execute PROGRAMME_ID`. It creates a new comparison programme that reuses the original baseline run and records the original intake programme ID. Completed run IDs are reused on restart.

Keep the original source resolution. The selected Gura grid is nominally 300 m, and a full 300 m cell occupies 9 ha. Native NDR export rates are kg/ha/year; native SDR export rates are metric tonnes/ha/year. The existing original producer converts rates using the actual affine cell area once. Its annual watershed masses enter the economic companion directly.

## Prepare and run the actual comparison

From the existing application directory, select the real retained receiving record and a new plan filename. The following argument names are placeholders for those existing local paths.

```bash
/opt/pyvenv/bin/python -B -m source_tools.gura_comparison catalog --receiving RECEIVING_JSON --output CLASS_CATALOG_JSON
/opt/pyvenv/bin/python -B -m source_tools.gura_comparison plan --receiving RECEIVING_JSON --output CLASS_PLAN_JSON
/opt/pyvenv/bin/python -B -m source_tools.gura_comparison execute --receiving RECEIVING_JSON --plan CLASS_PLAN_JSON --output COMPARISON_RESULT_JSON --workspace-backup WORKSPACE_ARCHIVE_ZIP
```

The plan command prints and saves the actual selected class pairs, exact original labels, original source rows, observed cell counts, native areas, profile, grid, watershed IDs and source hashes. For explicitly chosen original pairs, repeat `--convert FROM:TO` on the plan command. A source class must have cells in the retained reporting area; a target class must have an original profile row. The default completes the broad observed-class comparison automatically.

The execution command saves its plan and programme selection under the original Workspace's `gura-comparisons/OPERATION_ID/`. It records both the controlling worker and the native child process, their host, interpreter, command, timestamps and IDs. The native stdout/stderr remains in `native-programme.log`. If the existing job is already running, continue with its owner and retained programme rather than starting another copy.

After native completion, the command reads the actual `landcover.edits` cell counts and areas, builds one original S1 cohort across the saved baseline and alternatives, and exports an economic desk for each explicitly retained Gura watershed feature with common native output support. Each export includes the original source report text and a complete `decision-package.zip`. The result gives every original zone ID, report path, baseline/alternative run ID and export directory.

The optional Workspace archive must be outside the Workspace. On restart an existing archive is reused when its saved completion identity, path, byte count and SHA-256 match. If archive creation finished just before its record was saved, the continuation verifies the original archive manifest and all member hashes, the full native-cache/delivery selection, and this operation's source identity, completed result and native report before recovering that missing record. Repeating the same command reuses the selected native runs and retained report editions. If the economic source is still being installed, `--physical-only` completes the original native watershed report; rerunning the default command creates the full economic editions from those same completed runs.

## Complete the operator journey on that result

Use the economic edition's retained `selection.json` with the original S1 `decision.json` or `report.json` and its exact matching zone ID:

```bash
/opt/pyvenv/bin/python -B -m model.decision_receive --scenario-report SCENARIO_DECISION_JSON --zone-id ORIGINAL_ZONE_ID --selection ECONOMIC_SELECTION_JSON --output NEW_OPERATOR_RECEIVE_DIRECTORY --browser-executable /usr/bin/chromium
```

The existing receiving command opens the real desk, selects an available modeled axis and scenario, saves the case, reopens it, and retains the resulting browser outputs and timings. Return its result or first actual traceback to the existing GURA-NATIVE-01 thread with the original programme/run IDs so the same owners can finish any integration correction.

All initial cost entries are unentered. A later implementation estimate belongs to its named scenario and defined footprint; a selected-zone estimate stays attached to its original report and zone. Keep the Gura study title in the operator and exports. Regional Upper Savannah estimates and South Carolina assistance-payment schedules retain their own study and funding context.
