# Ecosystem robust decision studies

Private Ecosystem Sciences application contribution, ASTRA-ECO-OPT12, version 0.1.0.

This application receives complete modeled alternatives across parameter profiles,
calculates a resource-constrained decision, explains its physical outcomes and
tradeoffs, and retains the whole editable decision history. Source and customer
preparation belong in the private Slack workstream.

## Operator workflow

Install in an isolated Linux Python environment with the declared dependencies:

```sh
python -m pip install .
ecosci-robust serve --workspace /path/to/existing/workspace --port 8772
```

The local browser entry is `http://127.0.0.1:8772/`. The server binds loopback.
The workspace may be the existing native model workspace: decision data is stored
under its `robust_decisions/` directory; original raster/model files stay intact.

Receive a decision-study JSON, or select an original experiment summary plus a
decision configuration. Edit candidate costs, required/excluded choices, budget,
capacity, outcome scales, weights and physical targets. Save a revision and choose
an objective. Results include every profile, physical gain, target shortfall,
constraint margin and profile-specific benchmark. HTML, outcome CSV, complete
result JSON and implementation selections are downloadable. The complete project
includes all earlier revisions, runs, source identities and incoming provenance;
receiving creates an independently editable study without overwriting the sender.

Blank costs or weights are errors, not zero-cost assumptions. Blank budget/capacity
means no ceiling. A blank target adds no physical-gain constraint. Probabilities
must all be absent, or all be supplied and sum to one. They are not inferred.

## Modeling and decision semantics

`native_packages` chooses exactly one already-evaluated complete scenario package.
Package benefits are never summed across nonlinear native runs. Every feasible
package is evaluated directly; equal objective scores break ties by lower cost,
then candidate ID. This path avoids unnecessary integer-programming calls.

`additive_actions` chooses binary actions with a separately supplied explicit
`additive_basis`. It supports budget/capacity ceilings, group caps, required and
excluded actions, and joint physical-gain targets under every profile. The
mixed-integer path uses SciPy/HiGHS and validates the returned integer selection
against the original constraints. Use this mode only when its declared source
decomposition supports addition; passing whole native packages through the native
receiver always produces native-package mode.

For profile s and selected actions x, score(s,x) = sum(weight[m] * gain[s,m,x] /
scale[m]). Scales and weights are fixed within the saved revision. Gains retain
original units and signs; a negative gain remains an adverse physical outcome.

* Worst case maximizes the lowest included-profile score.
* Minimax regret minimizes the largest gap from that profile's best feasible plan.
* Expected score maximizes the probability-weighted score, using explicit supplied
  probabilities only.

All profile benchmarks use the **same feasible set**, including targets required
in every profile. This is deliberately a comparison of robustly feasible plans,
not a scenario-specific relaxation of the constraints. Regret needs certified
benchmark optima. A deadline-limited primary incumbent remains reported, with its
solver status/gap; incomplete benchmark calculations are not labeled optima.

When probabilities and optimal benchmarks are available, the report includes the
value of perfect profile information in normalized weighted score units. This is
not a currency valuation or a recommendation to purchase information. Time limits
are shared across the requested solution and diagnostics. Optional diagnostics do
not consume the primary worst-case/expected solve's entire allowance first.

For infeasibility, a separate target-relaxed comparison retains budget, capacity,
groups and membership constraints and shows physical shortfalls. It does not
replace the requested constrained result.

## Original experiment integration

The receiver binds the actual ES-EXP-2319 `upstate.experiment-summary/v1` contract:
`summary.rows`, `summary.id`, `workspace_id`, `grid_id`; completed `kind=landcover`
rows with their own `profile_id`, `scenario_id`, `baseline_run_id`, and `run_id`.
The complete-case `cases` form is also accepted when it has an explicit grid ID.

Requested metric records contain `units`, `baseline_total`, `alternative_total`,
`delta`, `reduction`, `paired_cells`, `coverage_fraction`, and `support_sha256`.
Gain is baseline minus alternative. There is no second area multiplication, raster
resampling, unit conversion, missing-cell fill or inferred candidate cost here.
Original case selection, runtime, output-artifact and comparison identities remain
in the retained cell provenance. Every requested profile/candidate pair must exist,
use that profile's same baseline, and compare the same support per metric. For
different support, prepare the common-support cohort with the existing ensemble
owner and receive that completed edition.

Configuration is a normal Study object without `cells`. Candidate IDs are the
original scenario IDs; profile IDs are the original native profile IDs. Supply
metric IDs and unit strings exactly as the original summary emits them. Costs,
capacity use, scales, weights, targets and optional probabilities are explicit
operator decisions, not guessed from model output.

```sh
ecosci-robust from-native summary.json configuration.json --output study.json
ecosci-robust solve study.json --objective minimax_regret --output decision.json
ecosci-robust frontier study.json --budgets 10000 25000 50000 --output frontier.json
ecosci-robust report study.json decision.json --format html --output report.html
```

### Existing Python Workspace and task queue

Place this complete source directory at
`opportunities/upstate_forever_2026/model/robust_decisions/`. It may be imported from
the original application root without installing a second model engine:

```python
from model.robust_decisions.eco_robust.operations import DecisionWorkspace

# ws is the already-open original model.workspace.Workspace.
decisions = DecisionWorkspace(ws)
study = decisions.import_experiment(experiment_id, configuration)
completed = decisions.solve(study['id'], study['revision'], 'minimax_regret')
```

`from_workspace` calls the original `model.experiments.read_summary(ws,id)`; it does
not recompute the summary or queue native InVEST runs.

For the original `operator/server.py`, admit the names in
`eco_robust.integration.ACTION_NAMES` through its existing ACTIONS registry. Inside
its current `_invoke(task)` after resolving the existing `ws`, `action`, and
`payload`, route these names through the following unchanged callable:

```python
from model.robust_decisions.eco_robust.integration import ACTION_NAMES, dispatch

if action in ACTION_NAMES:
    return dispatch(ws, action, payload)
```

The original `Operator.submit`, operation ID/request digest, queue, task lifetime,
resume and task decoration stay with the existing operator. There is no additional
native job scheduler. The browser panel can run privately alongside that host, or
a FastAPI host can include `service.make_router(ws)` and serve `service.panel_html()`.
The router has its own conflict/validation response handling; embedding hosts retain
their own authentication, same-origin and transport configuration.

### Implementation and field-work handoff

`robust.selection.export` accepts `{study_id,run_id}` and emits
`ecosci.robust-selection/1`. The export contains the exact selected candidate IDs,
cost unit, total cost/capacity, original candidate source objects, all profile
outcomes, and selected original cells including native baseline/alternative IDs.
`study_sha256`, `result_sha256` and execution/revision remain attached. The selected
portfolio is re-evaluated against the saved constraints before export. Complete
native scenarios remain complete; their original source objects carry any nested
intervention membership supplied by the planner.

The same packet is available in the browser's Implementation selection button and
`GET /api/robust/studies/{id}/selection?run_id={run_id}`. A frontier contains several
budget decisions: solve the chosen budget as a saved study revision before exporting
one implementation selection.

## Persistence, portability and deployment

SQLite WAL connections are private to each operation. Revisions are immutable;
optimistic revision checks reject conflicting saves rather than losing edits.
Calculations bind their exact revision and retain failed or completed results.
Linux OS file locks distinguish a live calculation from an ended process. Recovery
marks only unlocked running records as interrupted; replay creates a new retained
run. Received in-progress records become interrupted-on-transfer.

Project exports read one database snapshot. Receiving verifies the complete
revision chain and every result/input digest before a create-only transaction.
JSON semantic hashes normalize equivalent integral numeric forms (`1`/`1.0`),
while raw browser project export/import preserves the original JSON text. Numerical
model fields use finite floating-point values. Exact large identifiers should be
strings. CSV outcome labels are spreadsheet-formula escaped; original labels and
full provenance remain unchanged in JSON and HTML.

The standalone service is a local operator tool, not an unauthenticated internet
service. It is Linux-hosted; any modern desktop/mobile browser can be its frontend
when deployed behind the original operator's approved transport.

## Reproducible checks and arithmetic examples

`examples/` contains clearly identified authored arithmetic fixtures, not ecological
predictions. They exercise the original experiment record shape. In the four-package,
three-profile example, worst-case and minimax-regret choose C; expected score chooses
B; the maximum regret for C is 4 and EVPI is 1 normalized score unit.

```sh
python -m pytest -q tests/test_decisions.py
python -m eco_robust validate examples/arithmetic-study.json
```

The focused suite compares additive optimization with the complete enumerated
feasible population and exercises native receiving, sign/unit/support errors,
negative gains, infeasible targets, revision conflicts, genuine process death and
replay, full export/receive/edit/re-export, and the HTTP application. Browser DOM
checks use Chromium and the actual ASGI backend through an in-process transport;
the cloud browser's direct HTTP navigation was unavailable. The delivered application
itself uses ordinary same-origin fetch. Desktop/mobile screenshots and a generated
print report were visually inspected during development.
