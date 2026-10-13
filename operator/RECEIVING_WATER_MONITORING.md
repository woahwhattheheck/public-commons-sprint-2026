# Receiving-water priorities to a retained monitoring campaign

This workflow joins a saved receiving-water plan or completed model analysis to the original Monitoring design and field-operations desk. It creates a retained planning source and a native Monitoring network. The original ASTRA-MONITOR12 network, optimization, costs, calendar, campaign and field-history implementation remains in charge of subsequent decisions.

The implementation is part of the original TokenJunkieLabs Upper Savannah application. It uses the existing Workspace, Sources, operator queue, extension host, file tickets and portable transfer. No new server or job controller is required.

## Install the complete current application

Receive the complete maintained application cohort, including both receiving-water descriptors, the current Monitoring descriptor and runtime, and the original `integrations/monitoring/` package. Keep the current shared registry and the latest files from other desks. From the application directory:

```sh
python -B operator/install_receiving_waters.py --root . --check
python -B operator/install_receiving_waters.py --root .
```

The existing cumulative application assembler already calls this maintained installer. The installer requires the current shared extension host, checks the complete Monitoring runtime and its seven original actions, and composes the receiving-water joins against the actual installed source. It uses the original Monitoring migration functions to remove only recognized old direct hooks, so the shared registry remains the single registration path. Its current-source checks, retained preimages, compare-before-write behavior and rollback preserve unrelated edits. An unknown authored descriptor is reported for composition rather than silently replaced.

Use the existing scientific Python environment and the original application requirements, including `model/requirements-monitoring.txt` and the receiving-water raster dependencies. The original archive under `integrations/monitoring/src/` remains historical source; copying that older cohort over the current runtime would discard maintained integration changes. Restart the existing operator after source installation and reload its browser.

The current registered versions are receiving-waters 5 and Monitoring 1.3.0. Both receiving-water descriptor locations carry the same complete assets and actions. The registry discovers the providers and browser modules through those descriptors. The new model module is `model/receiving_water_monitoring.py`; the new browser module is `operator/web/receiving_water_monitoring.mjs`.

## Choose the actual water-study source

Open **Receiving waters** in the original Workspace. Start from a saved complete source plan or a completed saved analysis, and choose its monitoring preparation action.

| Starting point | Required selection | Weight |
| --- | --- | --- |
| Saved source plan | One or more original receptor IDs and the retained catchment source | Exact projected HUC overlap with the union of the selected contribution geometries, in hectares |
| Completed model analysis | One exact saved subject, an actual baseline or alternative run, and an available saved priority statistic | Sum of the actual valid dimensionless priority values multiplied by their original affine pixel hectares |

For either mode, choose a complete original catchment source edition and named entry. Enter its actual HUC ID and downstream ID field names, and its native layer when needed. These fields identify the retained source; default field labels do not establish what an uploaded source contains. String HUC IDs preserve leading zeroes. An optional original stratum field can be supplied through the native selection.

For source-plan mode, the selected contribution areas are unioned once before intersecting the catchments. Overlapping receptors therefore do not count their common area twice. Analysis fields are not accepted in this mode.

For model-priority mode, choose an individual receptor or a saved family union from the complete analysis. Baseline offers current priority. An actual alternative can offer current, increased-export or avoided-export priority when that exact saved artifact exists. The implementation reads that artifact; it does not recalculate a new normalization or substitute another run. The plan, analysis, quantity scope, pollutants, normalization, run, grid and original source identities remain recorded. Receptor IDs are not an independent selection in this mode.

## Preserve the full graph and identify the candidate scope

The derived WGS84 GeoJSON retains **every original HUC polygon, its complete original attributes, and its original downstream graph**. Polygons are transformed for the existing Monitoring reader; they are not clipped to the receiving-water area. Original downstream targets outside the retained source remain explicit.

Keeping context catchments is necessary even when their overlap is zero. For a path A → B → C, removing B would break upstream coverage at C. Context HUCs therefore stay in the network, receive zero target weight, and are distinguished from candidate HUCs by a positive geometric overlap.

The added fields use the reserved `rwmon_` prefix. A source already containing that prefix is rejected to prevent accidental reuse or replacement of an earlier derived source.

| Field | Meaning |
| --- | --- |
| `rwmon_huc12` | Original normalized HUC identity used by Monitoring |
| `rwmon_tohuc` | Original downstream identity used by Monitoring |
| `rwmon_in_scope` | Whether the original HUC has positive-area overlap with the selected receiving-water scope |
| `rwmon_priority` | Nonnegative target planning weight |
| `rwmon_overlap_ha` | Exact projected vector overlap hectares |
| `rwmon_mode`, `rwmon_units` | Explicit weight method and units |
| `rwmon_bridge_id` | Immutable preparation identity |
| `rwmon_valid_cells`, `rwmon_scope_cells`, `rwmon_invalid_cells` | Separate raster support counts in priority mode |
| `rwmon_valid_ha`, `rwmon_scope_ha`, `rwmon_valid_fraction` | Raster support area and fraction, separate from exact vector overlap |

The method records `recommended_excluded_ids` for context-only HUCs. Opening the saved bridge in Monitoring visibly prefills the original advanced `excluded_ids` constraint. This restricts prospective candidate sites while preserving their graph paths and upstream context. Review the advanced constraints before designing; the operator can edit them in the existing form.

When changing to another bridge network, source-specific required sites, station eligibility, stratum constraints, site-specific costs and incompatible pairs must be reviewed for that source. The handoff resets those source-specific choices, preserves the visible general budget, costs, calendar and solver controls, and explains the candidate exclusions. It does not silently create a design.

## Interpret area, raster support and missing coverage

Contribution-area weights use the plan's original projected metre CRS:

```text
weight = area(original HUC ∩ union(selected contribution geometries)) / 10000
```

Priority-weighted area uses the exact saved raster grid:

```text
weight = sum(valid saved score × abs(a × e - b × d) / 10000)
```

Here a, b, d and e are the original affine transform coefficients. Membership uses the original cell centre, and a retained cell contributes its whole affine area. The deterministic HUC order assigns a shared included centre at most once. Only HUCs with positive geometric overlap can receive selected raster support; touching context polygons retain zero weight.

Vector intersection hectares and whole-cell support hectares answer different questions and can differ at boundaries. The method and summary retain them separately. Masked, NoData and nonfinite values do not contribute. Valid score zero retains valid support and contributes zero weight. Saved finite priority values outside [0, 1] are rejected. Scope outside the original catchment partition is reported as unassigned vector overlap and, in raster mode, unassigned valid support and priority; it is not silently reassigned.

The derived weight is a planning coverage objective. It is not measured contaminant concentration, a probability of detecting an event, verified outlet placement, monitoring effectiveness or an estimate of pollutant removal. The original physical export quantities, units and normalization remain with the saved water analysis. Compare methods and missing support before choosing a budget.

## Bind actual stations and complete the campaign

Optional stations come from a retained original point source edition and named entry. Supply its actual station ID field and, when appropriate, a native layer, HUC field, original Boolean outlet-verification field, and explicit boundary assignments. Point coordinates are retained. No station is generated at a centroid or a HUC outlet.

The original Monitoring importer reports ambiguous or outside-domain assignments. An explicit boundary assignment must refer to a covering source polygon. Only an actual Boolean assertion establishes verified outlet placement for upstream station credit; text labels do not establish it.

After the queued preparation finishes, inspect the saved planning-source summary and complete files. Choose **Design a campaign** or **Open monitoring network**. The current shared host opens the original Monitoring desk, waits for its source refresh to finish, and selects the retained network in the same Workspace.

Enter the actual budget, site counts, setup and visit costs, programme overhead, dates, rounds, crews and travel assumptions. Review advanced exclusions, required sites, stratum minima, separation, existing station eligibility and source-specific costs. Choose local coverage or outlet-context coverage according to the original Monitoring interpretation. Costs and coverage assumptions remain explicit operator inputs.

Use the original design and budget-frontier operations. The solver retains feasibility diagnostics and any time-limited status. Open a feasible design and create its campaign. Bind planned visits to real retained stations before recording collected samples. Record sample IDs, occurrence times and observations through the existing immutable event workflow. A revised campaign preserves earlier events and requires reconciliation of incompatible station bindings.

The complete implementation and configuration contract remain in `model/MONITORING.md` and `operator/MONITORING_API.md`.

## Native API and operator registration

The existing queue action is `receiving.water.monitoring`. It passes the selection to the original Workspace provider. The authenticated read is `GET /api/receiving-waters/monitoring` with `monitoring_id` and the existing Workspace key. Reads, task progress and downloads use the existing operator transport.

The model API is:

```python
from model.workspace import Workspace
from model.receiving_water_monitoring import prepare, inspect, catalog

workspace = Workspace("/absolute/existing/workspace")
record = prepare(workspace, selection)
verified = inspect(workspace, record["id"])  # verifies retained files and source bindings
saved = catalog(workspace)                  # completed manifest summaries
```

Supply actual existing IDs. A source-plan selection has this shape:

```json
{
  "title": "Selected water contribution area — monitoring",
  "mode": "contribution_area",
  "plan_id": "ACTUAL_SAVED_PLAN_ID",
  "receptor_ids": ["ACTUAL_ORIGINAL_RECEPTOR_ID"],
  "catchments": {
    "source_collection_id": "ACTUAL_SOURCE_EDITION_ID",
    "source_id": "ACTUAL_CATCHMENT_ENTRY",
    "id_field": "ACTUAL_HUC_FIELD",
    "downstream_field": "ACTUAL_DOWNSTREAM_FIELD"
  }
}
```

For priority mode, replace `mode` with `priority_weighted_area`, remove `receptor_ids`, and supply `analysis_id`, `subject: {"kind": "receptor", "id": "ACTUAL_RECEPTOR_ID"}` or the exact saved `family_union`, `statistic` and an actual `run_id`. Omitting `run_id` chooses the actual baseline, for which only `current_priority` is accepted. The optional `stations` object accepts `source_collection_id`, `source_id`, `layer`, `id_field`, `huc_field`, `outlet_field` and `assignments`. Optional `stratum_field` names an original catchment attribute.

The returned complete record identifies the bridge, native network, source edition, plan and optional analysis, together with its identity, method, source files, support summary and station assignment issues. Use the returned network ID with the existing Monitoring operations; no second planning engine is introduced.

## Save, resume, export and reopen

Preparation acquires the Workspace's `.receiving-water-monitoring.lock` before source views or new files are written, then the per-bridge lock. Native Workspace capture takes the same root lock before inventory. A capture cannot silently include a partially prepared bridge.

The bridge ID binds the actual Workspace, normalized selection, implementation, original plan/analysis records, source identities and selected raster. A fixed `intent.json` timestamp is written before computation. Repeating an unchanged operation verifies and reuses its complete result. If interrupted, the same intent, files and source manifest resume. If the original Monitoring network import completed before the final bridge record was saved, the producer recovers that exact source-bound network by comparing its native content. It does not create a second timestamped network. A changed selection or implementation creates a distinct retained bridge.

The retained directory is `receiving-water-monitoring/<bridge-id>/`. It contains the intent, derived complete catchments, method, import manifest, prepared file identities and final bridge record. Provenance companions include the complete original catchment source and sidecars, source-edition record, original plan and selected receptor geometries, plus the original analysis and exact selected raster in priority mode. The derived source imports those companions through the original Sources API.

Export the original Monitoring field package and report from the saved campaign. Its source bindings preserve the derived planning source and provenance companions; optional stations remain separately bound to their complete original source. For full continuation, download **Complete editable workspace** and use the original Restore workflow. The complete Workspace carries the bridge directory, native source objects, network, designs, campaigns, calendar, field history and current application source.

In the receiving Workspace, reopen the saved planning source and its original Monitoring network and campaign. Verify the retained IDs, candidate exclusions, weight method and source bindings before changing a design. A receiving edit creates the normal native revision and preserves the sender's retained history.

## Source and validation boundary

The maintained integration preserves ASTRA-MONITOR12's complete original implementation and TokenJunkieLabs credit. The original archive and member identities remain in `integrations/monitoring/MANIFEST.json`; `integrations/monitoring/source_adoption.json` distinguishes current integration files from original archive bytes. The current component catalogue covers the receiving-water and Monitoring source cohorts, including this complete workflow.

Source composition and API review do not establish a successful native raster run or browser receiving session. Actual execution uses the existing scientific environment and original Workspace. Record the real task, outputs and receiving edits from that operation when available.
