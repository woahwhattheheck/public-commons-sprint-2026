# Scenario decision margins

A complete analyst course over **already-completed original native scenarios**: compare the riparian treatment with its matched control, explore whole-scenario expenditure and physical targets, inspect every native map cell, retain a decision, and send the edited inputs back through the original Economic queue. This adds no model scheduler or alternative scientific reducer.

## Open and work

Open `Scenario_Decision_Margins.html`. The file contains the full selected study, executable interface, all original source downloads and its producer. It needs no remote service or account for reading, editing, exporting or independent receiving. Browser-local storage is optional; **Save review** writes a small source-pinned JSON and **Save complete desk** writes the entire working product with the current choices. **Open review** receives a saved JSON for this exact source edition. The sender's original scientific files and native plans are unchanged.

Choose the included parameter profiles, then explore the treatment/control annualized expenditure ratio. Enter reviewed costs only when available, retaining their actual title, reference and date. A blank is unentered, while an explicit zero remains zero. Enter annual avoided-export targets separately. The map selectors expose all three original pollutants and five layers: baseline, treatment, control and the two baseline-minus-alternative differences. Mouse, row/column inputs and arrow keys inspect the original cell and all five values. Native GeoTIFFs, original Economic packages, source profiles, native reports, editable plans and complete producer files have direct byte-preserving download controls. Print produces a readable report of the current selection rather than pages of empty entry fields.

## Scientific and economic meaning

For a pollutant, let `Bt` and `Bc` be the original treatment and control annual avoided exports. When both are positive, the break-even ratio is `Bt / Bc`: treatment has lower expenditure per avoided unit when `annualized_treatment / annualized_control` is below that value. Each pollutant keeps its own units; no nitrogen/phosphorus/sediment score or monetary environmental benefit is invented. The all-listed-profile ceiling is the minimum of the defined within-profile ratios, only when every included profile has positive benefits in both alternatives. These are conditional parameter cases, not probability samples or a uniform-mask uncertainty interval.

Annualized expenditure is `capital / annuity_factor + annual_operation`. For real rate `r > 0` and horizon `n`, the factor is `-expm1(-n * log1p(r)) / r`; at zero rate it is `n`. These are constant real annual operating costs with no residual value. Both estimates describe the complete scenario and are reused across its parameter profiles. Assistance payments belong in a separate funding analysis. The original Economic producer independently recomputes these values on intake.

The delivered teaching case is the original 1,296 ha, 120 by 120 cell, 30 m **simulated square**, not the actual Upper Savannah regional geography. It retains four profiles and twelve completed native InVEST runs. The reported annual N/P kg and sediment tonnes are delivery to streams, not measured intake concentrations. Each native profile and pollutant keeps its actual common finite support. All native export cells are retained; the map multiplies per-hectare rates once by projected pixel area and checks every displayed total against the original native report. Different flow-profile masks are not silently pooled. Maps currently use complete in-memory arrays; the delivered full-resolution workload and source files are retained for capacity planning.

## Reproduce from the original application

Keep these five files together under `source_tools/scenario_margin/` in the original application. `build.py` uses its installed NumPy, rasterio, `model.workspace`, `model.scenario_decisions` and `model.decision_analysis`. It resolves the original complete report through `inspect_scenario_report`, not the small `decision.json` completion summary's hash.

```sh
python APP/source_tools/scenario_margin/build.py \
  --application APP --workspace WORKSPACE \
  --selection selection.json --output NEW_OUTPUT
```

The delivered `selection.json` is the complete example. Its schema is `upstate.scenario-margin-selection/v1`; it names the title, original classification, three distinct original scenario IDs, one saved Economic edition per selected profile, and optional Workspace-relative native implementation plan files. All editions must name the same project, grid and reporting zone. Every cohort must contain exactly the selected baseline, treatment and control. Earlier output directories are immutable; use a new path for a changed source or selection. `manifest.json` covers every output member, including full HTML, plain study JSON, all-profile CSV/JSON and all retained originals.

## Continue through the original Economic queue

Start the original application normally and retain its private operator URL in a private file. Select the registered Workspace key in that same application. Use **Download original Economic inputs** in the desk, then preview every selected profile:

```sh
python APP/source_tools/scenario_margin/intake.py \
  --application APP --study OUTPUT/study.json \
  --inputs Scenario_Margin_Native_Economic_Inputs.json \
  --operator-url-file PRIVATE_URL_FILE --workspace-key ACTUAL_KEY \
  --output RECEIVING_DIRECTORY
```

Add `--publish` to retain those same reviewed selections through `economic.edition.build`. This is the ordinary original queue; the helper cannot dispatch model jobs. It verifies the live native project, grid, profile, complete run cohort and all original physical outputs before admitting editions. The stable operation identity and task ID are written before/after admission. An interrupted or timed-out task remains in that queue: resume with the same input and receiving directory. A local exclusive journal lock prevents two receiving processes from overwriting the same course. The URL parser is the maintained `operator/economic_receive.py` helper; no token is printed or included in the public output. This native CLI is operated on Linux.

Saved native plan JSON opens in the original Implementation desk. Its candidate retains the original scenario, Economic edition, full report hash, reporting zone and scientific quantities. The treatment plan includes the original riparian method's seven planned activities. Field records remain planning inputs until actual activity is recorded.

## Complete working handover

The delivery also carries the original application and full Workspace in the native portable archive, including all retained intermediate and output files. Restore through that archived application's original `model/cli.py restore ARCHIVE NEW_DIRECTORY` route, then run the delivered application's own source. The selected Economic editions, native report IDs, implementation revisions and every historical native run are retained. Use the included receiving record to reopen the exact delivered identities before making an independent edit.

The operated browser course used actual supplied HTML, script execution, file controls and downloaded saved files at 1440 and 390 pixels. Its managed Chromium rejected URL navigation; no browser policy was changed. The native API/queue and independent archived-application receiving are separate actual operations. The final default desk leaves financial estimates and targets unentered. An explicitly labeled receiving exercise uses illustrative amounts only to exercise native round-trip behavior; it is not a contractor quote or an estimate for the regional project.

## Standing direction

The complete unchanged `CURRENT_OWNER_DIRECTION.md`, version `2026-10-13.3`, accompanies the output under `original-source/`. Its original Git identity is `8cd1c1f3d371a2fb75471813844e31f489aa8272`. Preserve active native operations, actual geography/units and original implementation ownership. Open, see and use the actual outgoing product and attachments. The October 13 sprint cutoff remains 14:00 UTC. Shared Economic comparison, priced programme and Study writers retain their existing paths; this component is additive.
