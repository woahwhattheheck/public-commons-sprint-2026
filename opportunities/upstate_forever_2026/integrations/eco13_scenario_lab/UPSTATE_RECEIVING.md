# Receive an original experiment into the scenario workbench

This guide continues an existing native experiment in the installed ECO13 scenario workbench. It takes the original saved experiment, cases and completed model outputs into a retained comparison edition, adds explicit planning costs and objectives, and exports an editable copy that another operator can reopen.

The receiving operation now uses independent filesystem copies, operation-local
original-file hash reuse and a final complete-tree membership check. It preserves
the original/ path layout and emits receiving-storage.json plus actual storage
counters in the receipt. Read [RETENTION.md](RETENTION.md) for those counters and
the portable receiving behavior; [WORKSPACE.md](WORKSPACE.md) documents explicit
baseline/alternative Workspace adoption.

## Choose the original study

In the original application, open the saved Workspace and experiment. Record the actual Workspace directory and the complete 64-character experiment ID. Read the selected grid, baseline, alternatives, parameter profiles and model families. Use that study's recorded resolution and reporting area. The Upper Savannah work order requests a 30 m regional product; the original Gura source programme uses its retained 300 m grid.

Run from the assembled application's root. The preserved package lives in integrations/eco13_scenario_lab/ and imports as eco_scenario_lab. Use the installed application Python with PYTHONPATH=.:integrations/eco13_scenario_lab, as shown below. In the commands below, ORIGINAL_WORKSPACE, EXPERIMENT_ID, NEW_COMPARISON, NEW_RECEIVED and OUTSIDE.zip are paths or IDs chosen from that actual study. Choose a new, separate comparison directory.

```console
PYTHONPATH=.:integrations/eco13_scenario_lab python -m eco_scenario_lab adopt-upstate ORIGINAL_WORKSPACE EXPERIMENT_ID NEW_COMPARISON --project-id PROJECT --setup-id EDITION --currency USD
PYTHONPATH=.:integrations/eco13_scenario_lab python -m eco_scenario_lab status NEW_COMPARISON
```

PROJECT and EDITION are the operator's portable project and edition identifiers, each 1–80 characters. Use the study's intended currency. The intake walks every original inspection page; --page-size 250 controls each source page, without limiting the experiment to 250 cases.

The receipt returns original_experiment_id, page_count, original_cases, adopted_case_model_slots, retained_complete_runs, retained_partial_runs, selected_models, paired_records, parameter_records, incomplete, status and report. Match the original experiment and case identities to the source operator. A complete intake exits 0. A partial intake exits 2 and retains the available results and its explicit incomplete list; review the receipt and reports/incomplete.csv when incomplete rows remain.

The status view distinguishes planned original runs, observed native runs, original case states and selected model slots. A combined NDR/SDR case has two model slots while retaining its one original run identity. Pending cases remain visible in that status view.

**Suggested demonstration narration:** “This is the experiment we already ran. The comparison keeps its original cases and results, and shows which parts are ready.”

## Review the result and its scientific coverage

Open NEW_COMPARISON/reports/index.html. Start with the received experiment identity, completion summary and selected model families. Then read the baseline/alternative labels, original scenario and profile IDs, reporting grid, spatial unit, metric, units and coverage for each compared result.

The outcome tables and unfinished-case table include every retained record with pagination and alternative/parameter/outcome filters. Print expands all filtered rows and preserves the current-state and cost-range columns, with paired-cell coverage alongside the physical values. Saved cost comparisons keep the objective population used to generate them. Full CSV and JSON downloads retain all rows regardless of the display filters.

A completed NDR selection supplies its nutrient outputs; a completed SDR selection supplies its sediment output. The historical combined selection can omit the models field: that original selection still means NDR and SDR. The intake preserves that meaning.

Completed cases from a partial experiment remain available. An unfinished or failed combined run keeps its original state and original run identity, even when one native stage has finished. Availability of a paired result requires the actual eligible complete case and its complete baseline and alternative runs. The incomplete table preserves cases that still need the original operator's continuation.

The native source defines change as alternative minus baseline, and avoided export as its negative. Positive avoided export therefore means a modeled reduction. Keep nitrogen, phosphorus and sediment in their own declared physical units. Read paired_cells, reporting_cells, coverage_fraction and support_sha256. The source percentage is relative to the paired baseline total and is undefined when that baseline is zero. Compare distinct coverage groups separately.

Parameter changes have their own comparison rows. Read parameter effects separately from land-cover intervention effects, and retain the distinction when both change. Rankings compare compatible case/metric groups using the same units, grid, support and original baseline identity. Those groups remain separate in the received report. A selected outcome with no shared valid cells keeps the affected alternative outside that cost screen, while the other complete alternatives remain usable.

**Suggested demonstration narration:** “These rows tell us what changed, where it changed and which model produced it. The assumptions and original baseline stay visible.”

## Add explicit costs and objectives

Costs use a JSON object keyed by the original alternative scenario ID, with integer values in cents. Start with an empty object when costs have not been supplied:

```json
{}
```

Save it as costs.json and add only the supplied intervention costs. An omitted cost remains null/unspecified in the report. Enter a zero only when zero is the intended supplied cost. Unknown costs remain visible and are excluded from cost Pareto comparisons.

Costs can be supplied during first receipt:

```console
PYTHONPATH=.:integrations/eco13_scenario_lab python -m eco_scenario_lab adopt-upstate ORIGINAL_WORKSPACE EXPERIMENT_ID NEW_COMPARISON --project-id PROJECT --setup-id EDITION --currency USD --scenario-costs costs.json --page-size 250
```

For an already received comparison, use its existing comparison operation:

```console
PYTHONPATH=.:integrations/eco13_scenario_lab python -m eco_scenario_lab compare NEW_COMPARISON --scenario-costs costs.json
```

This writes a retained report cost edition from the same original native results. Preserve the cost basis and source with the planning record.

Select objectives from metrics and spatial-unit IDs actually present in reports/comparisons.json. The objective selector accepts spatial_unit_id, or the existing watershed_id form, together with metric. Native grid summary rows use their recorded reporting-grid IDs. Copy the exact comparisons.rows[].watershed_id value, which also appears as spatial_unit_id in the native received edition; use that value as the objective's spatial_unit_id. Save the selected objectives as a JSON array in objectives.json. Replace both markers below with values copied from the received comparison:

```json
[
  {
    "spatial_unit_id": "ORIGINAL_REPORTING_GRID_ID",
    "metric": "SELECTED_METRIC"
  }
]
```

```console
PYTHONPATH=.:integrations/eco13_scenario_lab python -m eco_scenario_lab compare NEW_COMPARISON --objectives objectives.json --scenario-costs costs.json --budget-cents INTEGER
```

INTEGER is the explicit budget in cents. Omit --budget-cents when no budget is intended. Read each selected metric's reported direction and the explicit cost comparison. Inspect each compatible comparison group before making a planning choice.

**Suggested demonstration narration:** “These are the modeled outcomes with the costs and objectives we chose. We can change the planning assumptions and reopen the resulting comparison.”

## Export the retained edition

The received edition contains plan.json, state.json and upstate-received.json, together with original source records and report files. Its original directory retains the Workspace record, experiment plan and paged inspections, raw summary, selected grid, source collections and their original manifest objects, complete native run directories, arguments, logs and differences. Partial runs retain their original state snapshots and the available original files from finished selected-model stages.

The report outputs include reports/index.html and reports/comparisons.json. Paired comparison rows produce reports/comparisons.csv; parameter rows produce reports/parameter-effects.csv; remaining incomplete rows produce reports/incomplete.csv. Selected objectives produce reports/ranking.json.

Create the portable package outside the source comparison directory:

```console
PYTHONPATH=.:integrations/eco13_scenario_lab python -m eco_scenario_lab export NEW_COMPARISON OUTSIDE.zip
```

Open the report and comparison table. Check the actual study and scenario labels, selected model families, units, spatial coverage, currency and original identities. Keep the readable report, editable project and retained original files together in the exported package.

**Suggested demonstration narration:** “The handover includes the report, comparison data and the editable project that produced this view.”

## Receive and reopen the independent copy

Choose a separate recipient directory and receive the exported package:

```console
PYTHONPATH=.:integrations/eco13_scenario_lab python -m eco_scenario_lab receive OUTSIDE.zip NEW_RECEIVED
PYTHONPATH=.:integrations/eco13_scenario_lab python -m eco_scenario_lab status NEW_RECEIVED
PYTHONPATH=.:integrations/eco13_scenario_lab python -m eco_scenario_lab compare NEW_RECEIVED
```

Open NEW_RECEIVED/reports/index.html. The retained source snapshot supports this comparison independently of the original live Workspace and its GIS runtime. Match the experiment, cases, results and cost edition to the exported copy. The compare command reuses the saved reports/report-selection.json costs, objectives and budget when they belong to the same retained plan. The imported edition therefore reopens its existing planning view.

Make a recipient-owned planning edit with the same compare options, then reopen the report. Use --clear-budget to remove only the saved budget ceiling, or --reset-report-options to clear the saved planning-view choices. If new report options are invalid, the complete prior report edition is restored. Keep the original comparison and received directories distinct.

**Suggested demonstration narration:** “This is the transferred working copy. Its saved data lets the recipient inspect the same results and continue the planning comparison.”

## Continue the science in the original operator

Return to the original application's normal opening route and Workspace. Open the retained experiment and the actual case or programme that needs work. Continue through its existing queue, progress and recovery controls. Preserve its original run/task identity when resuming interrupted work.

As more cases finish, receive the updated original experiment into a new comparison edition. Keep the earlier edition so the changed case coverage and outputs remain explainable. For the screenshare, open one completed received report and the original operator's current live state. Record the actual opening, receiving and export timings from that operated edition.

**Suggested demonstration narration:** “The original application continues the model work. Each finished case can enter the comparison with its original history.”

## Native integration and saved selection

The saved selection interface uses the following fields. Replace the workspace and experiment placeholders with the actual original values before saving.

```json
{
  "schema": 1,
  "source_format": "upstate.experiment/v1",
  "workspace": "ORIGINAL_WORKSPACE",
  "experiment_id": "ORIGINAL_64_CHARACTER_EXPERIMENT_ID",
  "project_id": "PROJECT",
  "setup_id": "EDITION",
  "currency": "USD",
  "scenario_costs": {},
  "page_size": 250
}
```

Receive that saved selection with the ordinary dispatcher:

```console
PYTHONPATH=.:integrations/eco13_scenario_lab python -m eco_scenario_lab adopt selection.json NEW_COMPARISON
```

An existing original operator can pass its Workspace object directly:

```python
from eco_scenario_lab.upstate_intake import adopt_workspace

received = adopt_workspace(
    operator.ws(workspace_key),
    experiment_id,
    destination,
    project_id=project_id,
    setup_id=setup_id,
    currency=currency,
    scenario_costs=scenario_costs,
    page_size=250,
)
```

The file interface is:

```python
from eco_scenario_lab.upstate_intake import adopt

received = adopt(selection_path, destination)
```

The receiver reads the existing experiment and its retained native outputs. The original operator remains the place to execute or resume scientific cases.

<!-- ecosystem-current-work-order:2026-10-13.3:begin -->
## Current demonstration receiving assignment

Carry the complete [current owner brief](../../CURRENT_OWNER_DIRECTION.md), version `2026-10-13.3`, into each current cloud/provider/child assignment and onward handoff. Its full self-contained copy is in this package's [AGENTS.md](AGENTS.md), including all four direct owner instructions. Source brief Git blob: `8cd1c1f3d371a2fb75471813844e31f489aa8272`.

The hard priority is the actual Upper Savannah simulated native model and connected usable product. Use actual geographic/source shapes and the 30 m grid; preserve the upstream contributing model domain, South Carolina reporting mask and utility focus separately. The current execution owner retains the original baseline, realistic restoration and matched-control calculation. Clearly label realistic simulated inputs, keep parameters/source editions editable, and report actual annual N/P in kg/year and sediment in tonnes/year delivered to streams. Keep load distinct from concentration and stream output distinct from intake exposure.

Continue this existing receiver on that owner's actual completed experiment. Runtime/source availability or a receiving plan is not the run. Preserve the live calculation, one writer per Workspace and the original run/task/source identities. Use the existing equipped runtime or an isolated actual execution environment through the current execution owner when needed; do not start a second controller. Other builds continue. Tim's team already practices GIS, watershed/environmental modeling, analysis, map/report publishing and natural-capital decision support. Show a concrete production workshare rather than assuming a capability gap; the prime retains scientific direction, method choices, review and the client relationship.

Demonstrate choose inputs/assumptions → run → inspect differences → revise → export and cold-reopen an editable package his team can continue. Show actual produced artifacts and real elapsed history without invented timing or guaranteed reactions. Open, LOOK at and operate the exact outgoing product and ALL attachments as the recipient, including relevant desktop/narrow widths, meaningful states, downloads and extracted archive/project reopening. Fix concrete defects in the same plain industrial product. If media is used, record the actual working app, use natural generative TTS where available, and watch/listen to the final export; generated screens cannot stand in for execution.

Carry the complete direction onward at the next safe message boundary, with the durable path/version and next substantive result. No bid/prime-yes gate, arbitrary feature cap, broad suite or review/test theatre. Keep active calculations and substantive integration moving. Preserve owner-stopped/deleted work, all existing attribution/contact/meeting/spend/source controls, no private GitHub/Actions and the October 13, 2026 10:00 a.m. Eastern / 14:00 UTC cutoff. This propagation does not request a restart or pause.
<!-- ecosystem-current-work-order:end -->
