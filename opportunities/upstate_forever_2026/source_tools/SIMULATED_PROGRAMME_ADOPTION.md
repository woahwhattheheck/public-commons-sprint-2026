# Adopt the completed simulated headwaters case into Programmes

The accepted headwaters runner creates original native runs, a comparison, a mapped delivery and a receiving record. This command gives those same completed runs a named Programme, an original comparison report and a ready native-study selection in the maintained operator.

## Receiving command

Use the current installed application containing the Programme native-study workflow and the original completed `demo-receiving.json`. The workspace may be the original or its verified restored edition; its project and source identities must match the receiving record.

```bash
"$DEMO_PYTHON" -B "$DEMO_APP/source_tools/adopt_simulated_headwaters_programme.py" \
  --workspace "$DEMO_WORKSPACE" \
  --receipt "$DEMO_OUTPUT/demo-receiving.json" \
  --output "$DEMO_OUTPUT/programme-receiving.json"
```

Set the four variables to the receiving interpreter, installed application, retained workspace and accepted runner output directory. Run this after the accepted native owner has completed the original baseline and conservation NDR/SDR cases. The command checks the actual states and original runtime provenance before writing a Programme.

The completed-only Workspace adapter takes the original run lock and verifies every retained model artifact. It returns the existing run as reused and has no native execution branch. The maintained Programme owns its normal state transitions, paired comparisons, reports and delivery preview. A missing or unfinished native run produces an actionable error identifying that run.

## What appears in the operator

Open **Programmes** in the same workspace and select the new programme ID printed in `programme-receiving.json`. The named baseline and conservation rows retain the original native run IDs, grid, profile, scenarios and source collection. The report exposes annual nitrogen and phosphorus in kilograms and sediment in metric tonnes, with the native common-cell change and its coverage.

The Programme's **Export native study** pathway is now usable for these rows. Its report compares every adopted alternative. An existing mapped delivery can cover a subset, such as restoration before the control was added; the adoption record explicitly retains that delivery's run IDs and preserves its original map selection. The adoption record includes its authenticated workflow selection and preview. When the accepted runner has already produced a mapped delivery, its original overlays, native-process report and source references are carried into that selection; the existing delivery ID is retained beside it. Source, renderer or application upgrades can create a new mapped delivery edition through the maintained export pathway.

The command verifies the original receipt's recipe hash, simulated classification and input summary. It reads the dimensions, changed cells and assumptions from that retained recipe. It does not hard-code an earlier corridor count or represent the simulated inputs as observations. The accepted successor runner embeds its original `control` preparation record in `demo-receiving.json`; the adopter reads it automatically. An earlier receiving edition may instead supply `--control-receipt "$CONTROL_PREPARED"`, where that variable names the original `control-prepared.json` produced by `source_tools/simulated_headwaters_control.py`. When both are supplied, their contents must match. The command recognizes both original published control-input editions: `upstate.simulated-control-input/v1` with `base_recipe`, and the accepted successor's `upstate.simulated-matched-control/v1` with `source_recipe_sha256`, original grid and `MATCHED_CONTROL_MASK` role. It verifies the separate mask collection, retained control-input document and original recipe hash, then requires the already-completed control run on the same grid and profile. It appends the named `matched-control` once, or matches it when a successor demo receipt already lists the same run. The original two-case Programme remains retained if a later adoption adds this third case.

## Portable receiving order

The downstream delivery owner should run this adoption before the final portable capture so that the Programme and its original reports are included. If an earlier archive already exists, keep it and create a new archive edition at an external destination. Use the existing independent cold-reopen workflow to start a fresh interpreter from the restored application's source and inspect the retained programme ID, baseline, alternatives and mapped delivery.

Keep `demo-receiving.json` unchanged. The separate programme record includes its exact path, byte length and SHA-256, the original run/source identities, retained report file descriptors, delivery selection and measured adoption/reconciliation times.

## Source compatibility

The command is additive and was reviewed against the maintained application at [merged PR3548](https://github.com/woahwhattheheck/public-commons-sprint-2026/pull/3548), commit `2a2bb5b63139e9a64637e64bac76b684ac4e676a`, and the accepted embedded-control contract at `757f35cec22f586f2affbf4e36b52c7b4a070a48`. It uses `ComputeProgrammes.preview/create/execute/read_report/delivery_preview`, original `native_run_id` binding and the native-study export installed by that release. The original generator contract is `source_tools/simulated_headwaters.py`; its receiving schema is `upstate.simulated-demo-receiving/v1`.
