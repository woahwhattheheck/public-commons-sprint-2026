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

A repeated adoption reopens an already-complete Programme and verifies its original report, selected native rows and retained report files. It preserves that Programme's progress and comparisons instead of adding another execution attempt. A missing or incomplete report uses the original completed-output-only reconciliation path; an invalid retained report remains an error. The receiving record exposes `programme_reused` for this distinction.

## What appears in the operator

Open **Programmes** in the same workspace and select the new programme ID printed in `programme-receiving.json`. The named baseline and conservation rows retain the original native run IDs, grid, profile, scenarios and source collection. The report exposes annual nitrogen and phosphorus in kilograms and sediment in metric tonnes, with the native common-cell change and its coverage.

The Programme's **Export native study** pathway is now usable for these rows. Its report compares every adopted alternative. An existing mapped delivery can cover a subset, such as restoration before the control was added; the adoption record explicitly retains that delivery's run IDs and preserves its original map selection. The adoption record includes its authenticated workflow selection and preview. When the accepted runner has already produced a mapped delivery, its original overlays, native-process report and source references are carried into that selection; the existing delivery ID is retained beside it. Source, renderer or application upgrades can create a new mapped delivery edition through the maintained export pathway.

The command verifies the original receipt's recipe hash, simulated classification and input summary. It reads the dimensions, changed cells and assumptions from that retained recipe. It does not hard-code an earlier corridor count or represent the simulated inputs as observations. The accepted successor runner embeds its original `control` preparation record in `demo-receiving.json`; the adopter reads it automatically. An earlier receiving edition may instead supply `--control-receipt "$CONTROL_PREPARED"`, where that variable names the original `control-prepared.json` produced by `source_tools/simulated_headwaters_control.py`. When both are supplied, their contents must match. The command recognizes both original published control-input editions: `upstate.simulated-control-input/v1` with `base_recipe`, and the accepted successor's `upstate.simulated-matched-control/v1` with `source_recipe_sha256`, original grid and `MATCHED_CONTROL_MASK` role. It verifies the separate mask collection, retained control-input document and original recipe hash, then requires the already-completed control run on the same grid and profile. It appends the named `matched-control` once, or matches it when a successor demo receipt already lists the same run. The original two-case Programme remains retained if a later adoption adds this third case.

## Open the same completed case in Guided journey

Edition 1.2 adds `operator_opening` to the separate Programme receiving record. It selects the original baseline, grid, profile, conservation scenario, completed run, comparison, paired SpatialReview when present, and existing mapped delivery. The focus is the first original conservation alternative included in that mapped delivery. Both matched-area cases remain in the Programme. The opening identity binds the real project, recipe, Programme, run order and selected records; repeating the adoption does not create a new opening identity.

The existing receiving owner can save that opening through its already-running maintained Operator before the final archive:

```python
from source_tools.adopt_simulated_headwaters_programme import save_operator_opening

opening = save_operator_opening(operator, workspace_key, programme_receiving)
```

Here `operator` is the receiving workflow's existing live `Operator`, `workspace_key` is its original registered workspace key, and `programme_receiving` is the decoded adoption result. The helper uses the original session validator, revision conflict check and lock. An already-saved identical scientific selection is reused without replacing the operator's notes. When selecting this case from a different saved view, the original API retains prior notes in its existing history. The returned `operator_session` is the exact saved record; `operator_session_file` records the actual bytes and SHA-256 of `operator-session.json`.

The complete headwaters driver freezes the original adoption input and result inside the Workspace and supplies their descriptors to the archived application's `compute_programme` receiving check. The teaching adapter then carries that saved adoption into the existing rehearsal. Its receiving workflow saves the opening through its live Operator before the browser course and final archive. After restoration and the normal Operator restart, it verifies the exact archived `operator-session.json` and selected Programme. Run `source_tools/simulated_headwaters_rehearsal.py` against the completed case to use that joined course; the manual helper above serves an already-owned receiving workflow.

After the normal authenticated operator connection, open **Guided journey** (`#journey`). A fresh browser restores the saved project view and shows its selected native comparison, paired map and delivery; **Run programmes** contains the named adopted Programme. The private access token remains in the existing connection flow. An existing browser retains its local draft and can use the existing **Open saved project view** control to select the received case. The JSON under `operator_opening.journey` also uses the existing journey import format if an operator chooses to import it manually.

Before handing over the received edition, the producing operator must open that exact application, inspect its rendered Guided journey and Programme report, operate the comparison, map and download controls, and save and reopen the selected view. Inspect the actual desktop and phone layouts and retain the resulting screen observations with the receiving record.

## Portable receiving order

The downstream delivery owner should run this adoption before the final portable capture so that the Programme and its original reports are included. If an earlier archive already exists, keep it and create a new archive edition at an external destination. Use the existing independent cold-reopen workflow to start a fresh interpreter from the restored application's source and inspect the retained programme ID, baseline, alternatives and mapped delivery.

Keep `demo-receiving.json` unchanged. The separate programme record includes its exact path, byte length and SHA-256, the original run/source identities, retained report file descriptors, delivery selection and measured adoption/reconciliation times.

## Source compatibility

The command is additive and was reviewed against the maintained application at [merged PR3548](https://github.com/woahwhattheheck/public-commons-sprint-2026/pull/3548), commit `2a2bb5b63139e9a64637e64bac76b684ac4e676a`, the accepted embedded-control contract at `757f35cec22f586f2affbf4e36b52c7b4a070a48`, and the maintained operator/session and Guided journey APIs at `3cfd121c33b6e1b44e1e5a7c55c9f8a3a664ac49`. It uses `ComputeProgrammes.preview/create/execute/read_report/delivery_preview`, original `native_run_id` binding and the native-study export installed by that release. The original generator contract is `source_tools/simulated_headwaters.py`; its receiving schema is `upstate.simulated-demo-receiving/v1`.
