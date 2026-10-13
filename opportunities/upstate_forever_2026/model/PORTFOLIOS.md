# Conservation portfolios

The portfolio workbench joins original polygon inventories, supplied cost
estimates, conservation preferences, resource limits, native scenarios and
delivery in the original scientific Workspace. Planning units can be original
parcels, subwatersheds, catchments or another explicitly identified polygon layer.

## Operating journey

1. Build a native planning inventory from an actual completed baseline, optional
   completed alternatives and an original polygon source, or choose an existing
   delivery with a completed parcel inventory.
2. Select the actual baseline or completed land-cover alternative and the
   meaning of its objective.
3. Set pollutant weights, coverage, protection and source-water filters,
   then budget, reporting-area or parcel-count limits.
4. Optionally select a retained per-feature USD cost CSV. Preview the join,
   ranking, feasible selection, upper bound and preference stability.
5. Save the specification and full source-bound analysis.
6. Convert chosen parcels to an explicit land-cover treatment using their
   original geometry and the retained reporting boundary.
7. Prepare and execute that ordinary scenario through the existing native
   model. Its completed comparison supplies the combined treatment result.
8. Build the printable portfolio report and download its complete ZIP.
9. Open the economic decision desk for a completed portfolio run. Supply
   the cost basis, capital or annual operating amount, planning horizon,
   discount rate and source. The action completes a matching baseline
   when needed and exports the actual paired physical and economic result.

The original NDR/SDR engines, grid, profile and stage recovery remain the model
execution route. Portfolio preference analysis reuses their retained values.

## Module and host contract

Module: `model.portfolios`.

| Function | Result |
| --- | --- |
| `preview(workspace, selection)` | Complete candidate/rank/stability analysis and feasible selection |
| `save_portfolio(workspace, selection)` | Immutable `portfolios` record plus retained input and analysis files |
| `get_portfolio(workspace, id, details=True)` | Verified record with its full analysis under `analysis` |
| `overview(workspace)` | `portfolios` and `portfolio_reports` collections |
| `prepare_scenario(workspace, selection)` | Ordinary saved land-cover scenario with its native `id` |
| `build_report(workspace, selection)` | Immutable `portfolio-reports` record and complete report archive |
| `build_decision_report(workspace, selection)` | Complete native scenario economic decision desk linked to the saved portfolio |
| `verify_portfolio(workspace, record)` | Record, source, selection and retained-file inspection for receiving |
| `invoke(workspace, action, payload)` | Dispatcher |

Actions are `portfolio.inventory.build`, `portfolio.preview`, `portfolio.save`,
`portfolio.scenario.prepare`, `portfolio.report.build` and `portfolio.decision.build`.
The host composes `portfolio.run.prepare` and `portfolio.run.start` from
`prepare_scenario`, `Workspace.prepare_run` and `Workspace.run`.

Keep the saved portfolio's `context.grid_id` and default to its
`context.profile_id`. The scenario carries `portfolio_id`,
`portfolio_analysis_sha256`, `portfolio_reporting_grid_id`, original selected
feature IDs and source references. A changed scientific profile remains
an explicit selection.

Disk collection names are `planning-inventories`, `portfolios` and `portfolio-reports`;
overview keys are `planning_inventories`, `portfolios` and `portfolio_reports`. File references are relative
to the Workspace root and use the original verified file-ticket mechanism.

## Original polygon intake

Use **Build native inventory** in Conservation portfolios, or
`Workspace.build_planning_inventory(selection)`. Select an actual completed
baseline, optional compatible alternatives and a retained original vector
source. The selection has the following shape:

~~~json
{
  "title": "Original subwatersheds",
  "baseline_run_id": "<completed baseline>",
  "scenario_run_ids": ["<completed alternative>"],
  "source_collection_id": "<retained collection>",
  "source_id": "<original polygon source>",
  "unit_kind": "subwatershed",
  "feature_id_field": "<existing original ID field>"
}
~~~

`unit_kind` accepts `parcel`, `subwatershed`, `catchment` or
`planning-unit`. Optional `layer` and `where` choose the original source
layer and feature filter. Omit `feature_id_field` to retain the source
driver's original feature identifiers. The operation retains every selected
feature intersecting the reporting area, including zero-coverage features.
It processes native rasters in windows and preserves the original grid.

The saved record's `files.csv` and `files.inventory` are relative to the
Workspace root. `model.planning_inventory.inspect(workspace, id)` verifies
both files and current source/run lineage. Scientific backups retain and
verify this collection on restore.

## Preview and save specification

Select real IDs from the opened Workspace:

~~~json
{
  "title": "Upper Savannah conservation selection",
  "purpose": "Compare the selected priorities and supplied resource limits.",
  "delivery_id": "<existing delivery ID>",
  "objective": {
    "kind": "restoration",
    "scenario_run_id": "<completed alternative run ID>",
    "basis": "total"
  },
  "weights": {
    "nitrogen_export": 1,
    "phosphorus_export": 1,
    "sediment_export": 1
  },
  "filters": {
    "min_coverage_fraction": 0.95,
    "max_protected_fraction": 1,
    "source_water": "any",
    "high_quality_water": "any",
    "include_feature_ids": [],
    "exclude_feature_ids": []
  },
  "constraints": {
    "budget_usd": null,
    "area_ha": null,
    "max_count": null
  },
  "costs": {
    "source_collection_id": "<cost source collection ID>",
    "source_id": "<original table ID>",
    "feature_id_field": "feature_id",
    "cost_field": "cost_usd",
    "currency": "USD"
  },
  "solver": "deterministic",
  "stability": true
}
~~~

Omit `costs` when no costs have been supplied. A budget requires a supplied
cost table. Null resource limits are unrestricted; zero is a zero limit.
Source-water filters accept `any`, `yes` or `no`. IDs are exact original
strings. Weights are nonnegative, with at least one positive value, and are
normalized to sum to one. When weights are omitted, available native inventory
outputs receive equal weight; unavailable pollutants remain unselected.

| Objective | Physical value |
| --- | --- |
| `restoration` | Baseline minus the selected actual alternative parcel export |
| `avoided-conversion` | Selected actual conversion alternative minus baseline export |
| `current-export` | Actual baseline parcel export |

For current export, omit `scenario_run_id`. Other objectives require an
alternative belonging to the selected inventory, completed on its original
grid and parameter profile. `basis` is `total` or
`per-reporting-hectare`. Baseline mass and original signed scenario changes
remain separately available.

Choose exactly one of `inventory_id` and `delivery_id`. An `inventory_id`
selects an original polygon inventory created by `model.planning_inventory`;
its coverage is common-valid native support across every selected run and
common pollutant within the retained reporting area. The application sums
its annual-mass-per-pixel outputs once. Original geometry, attributes, source
body and sidecars, feature IDs, model selections and output hashes are retained.

A `delivery_id` selects the exact `parcel-priorities.csv` and matching
inventory made by `model.priorities.parcel_inventory`. Its coverage fraction
measures baseline combined-priority valid cells. The source's own coverage
definition is retained in the portfolio context.

Unknown protection, source-water and high-quality context remain unknown.
A restrictive filter excludes an unknown value and records the reason; an
unrestricted filter preserves it. Independent overlapping polygon summaries
are not unique regional totals. The combined selected native run supplies
the evaluated portfolio effect.

Costs join from a retained table using its selected original ID and USD
columns. Duplicate IDs, malformed amounts, negative values and precision
below one cent are rejected with their source row. Blanks and absent rows
remain unknown. Budget selection excludes unknown costs and reports them;
without a budget they can remain in a portfolio whose known subtotal and
unknown total are separate. Unused cost IDs are also reported.

## Preference scores and stability

Each pollutant objective is divided by its maximum absolute value among
source-qualified parcels, before unknown cost exclusions. The same
denominators remain fixed across weight profiles. Adverse effects retain
their negative sign. Zero and negative total scores are left out of optional
benefit-maximizing selections.

This parcel objective is distinct from the original raster `priority_mean`,
which remains separately visible.

Default preference profiles use only pollutants actually present in the inventory:
the selected weights, equal weights, individual available pollutant axes and
half/double changes to each positive selected weight. A requested positive
weight for an unavailable pollutant is rejected with the missing metric. Duplicate normalized profiles are removed. `stability: false` keeps
only the selected profile. Explicit profiles are also supported:

~~~json
{
  "stability": {
    "enabled": true,
    "profiles": [
      {
        "name": "Drinking-water emphasis",
        "weights": {
          "nitrogen_export": 2,
          "phosphorus_export": 2,
          "sediment_export": 1
        }
      }
    ]
  }
}
~~~

Each candidate retains minimum/maximum/mean rank, selected-profile count,
total profiles, availability across profiles and selected fraction.
An unavailable new objective is not invented for a preference profile.
Selection frequency describes these planning preferences; it is neither a
success probability nor a scientific confidence interval. No model rerun is
needed for preference changes.

## Solver and bounds

The standard-library solver compares objective order, active resource
densities, combined resource density and the best feasible individual parcel.
It independently checks the resulting totals.

Budgets use integer USD cents, counts use integers, and area uses finite
double precision with a reported numerical tolerance. A zero area cap remains exactly zero. Fractional bounds and the optional solver use the same effective area cap as the independent feasibility calculation. Exact rational density comparisons prevent overflow or underflow from changing relaxation order; the published bound is rounded outward. The upper bound is the
minimum of independent fractional budget and area relaxations, the exact
count-only relaxation and all positive objectives.

The status is `optimal` when every positive candidate fits, the count-only
solution is exact, no positive feasible candidates exist, or the relaxation
bound closes. Otherwise it is `feasible` with an objective, upper bound,
absolute gap and relative gap. An open bound stays visible.

`solver: "scipy-milp"` opts into already-installed SciPy/HiGHS.
It installs no dependency. `solver_time_limit_seconds` defaults to 20.
The returned integer selection is checked against the same exact budget and
area/count rules. Unavailable SciPy or an unusable optional result preserves
the completed deterministic result and its solver state. Native optimal
status requires a matching objective and feasible integer selection.
Other preference profiles retain deterministic selections and their bounds.

## Analysis, saved data and receiving

Preview returns `context`, normalized `request`, `normalization`,
`counts`, all `candidates`, `selection`, `optimization`, `stability`
and `methods`. Candidate rows include original IDs/attributes, areas,
coverage, protection/source-water context, cost, objective values, rank,
eligibility/exclusions and rank stability.

Saved records keep the summary and file references. Full candidates and
profiles are retained in `analysis.json` and `candidate-ranking.csv`.
The data directory also contains `selected-parcels.csv`,
`source-manifest.json` and exact `input-parcels.csv` and
`input-inventory.json`. This preserves reopening when an archive excludes
older delivery directories to avoid recursively packaging earlier releases.

Use `verify_portfolio` during original archive receiving and verify each
`portfolio-reports` file with the existing file reader.

## Ordinary native treatment scenario

A uniform action supplies `portfolio_id`, `title`, an actual `reason`,
`from_codes` as integer original land-cover classes and `to_code` as one
integer destination class.

For several treatments, supply `treatments` containing objects with
`feature_ids`, `from_codes`, `to_code` and `reason`. Every selected
feature must belong to one treatment. Declared order controls geometric
overlaps among distinct original parcels.

The function reads actual original polygons, checks their attributes against
the inventory, and intersects the reporting boundary in the retained model
grid CRS, using the same coordinate operation as the original parcel
inventory. It preserves original feature identities and selected coordinates
in a GeoPackage imported through `Workspace.import_sources`. The saved
source includes its exact file hash and the selected geometry is checked
against the original polygons when reopened. The normal saved scenario
contains one source-bound patch per treatment.

Summed selected parcel changes describe contributions in an existing whole
scenario. The existing model run computes the combined chosen treatment,
including watershed routing and land-cover interactions.

## Report

`build_report` accepts `portfolio_id`, optional `title`,
`evaluation_run_id` and `comparison_id`. The evaluated run must use the
saved portfolio scenario and original grid. Its comparison uses the completed
portfolio run and a baseline with the original baseline land cover, matching
the evaluation's parameter profile, native version and selected models.
When needed, the queued action prepares and executes that matching baseline.
The original ranking baseline remains separately identified. Set
`run_missing_baseline: false` to prepare the baseline for an explicit later run.

The plain printable report contains the objective, limits, selection status,
physical contributions, every selected parcel, preference stability and
source identities. The complete ZIP contains the report, full and selected
candidate CSVs, analysis, manifest, exact input CSV/inventory, and optional
actual evaluated-run record. All source, scenario, evaluation and report IDs
remain in the original Workspace.

## Whole scenario decision desk

Action `portfolio.decision.build` composes the completed portfolio run with
the existing `model.decision_analysis` companion. It saves a
`whole-scenario-decision` entry in the existing `portfolio_reports`
collection, with `files.report` for the offline desk and `files.archive`
for its full source and result ZIP.

Supply `portfolio_id` and `evaluation_run_id`. An optional
`comparison_id` may include additional completed alternatives. Without it,
the adapter creates the ordinary native comparison of the paired baseline
and portfolio run. A changed evaluation profile or model selection uses that same profile,
native engine version and selected models with the original baseline definition. The boolean
`run_missing_baseline` defaults to `true`: this queued action prepares or
reuses an incomplete matching baseline, executes it through the ordinary
native runner, and continues into the completed decision export. Existing
native run locks and completed stages govern recovery. With
`run_missing_baseline: false`, an absent baseline is prepared and its
actual run ID and state are returned in the action error for the Runs
workspace. A completed matching baseline is reused in either mode.

Economic assumptions are explicit. Omit `economics` to retain unknown
costs in the physical decision desk. Otherwise supply:

~~~json
{
  "economics": {
    "basis": "selected-parcel-capital",
    "currency": "USD",
    "annual_operating": "<supplied number, including an explicit zero>",
    "horizon_years": "<supplied positive number>",
    "discount_rate": "<supplied nonnegative real rate>",
    "source": {
      "title": "<actual economic source>",
      "uri": "<actual source reference>",
      "as_of": "<ISO calendar date>"
    }
  }
}
~~~

The numeric placeholders above describe operator inputs.

| Basis | Capital | Annual operating |
| --- | --- | --- |
| `selected-parcel-capital` | Complete original selected per-feature USD estimate sum | Explicitly supplied `annual_operating` |
| `selected-parcel-annual-operating` | Explicitly supplied `capital` | Complete original selected per-feature USD estimate sum |
| `whole-scenario` | Explicitly supplied `capital` | Explicitly supplied `annual_operating` |

The two selected-parcel bases require every chosen parcel's supplied price
and retain USD. The original exact estimate and source remain in
`physical-input.json`, along with the explicit economic classification.
An annual operating cost, horizon, discount rate and source date are never
inferred. The whole-scenario basis preserves the supplied currency.

Optional `decision` contains the peer's ordinary `costs` for other runs,
`budget`, annual avoided-export `targets`,
`sensitivity_comparison_ids`, `notes`, and
`top_parcels_per_pollutant`. A cost record keyed to the portfolio run may
also be supplied directly in `decision.costs` by omitting `economics`.

The desk reads actual baseline/alternative rasters and uses the peer's
common-support annual mass calculation. The previous ranking delivery
predates the portfolio run; the adapter carries its source identity in
`portfolio_selection` and does not insert that delivery as the new
comparison's parcel results. An explicitly selected `decision.delivery_id`
must contain the new completed comparison.

The report carries the physical input packet, native run/comparison IDs,
explicit costs and sources, selected parcel context, complete economic desk
source, CSVs and ZIP. Its evaluation baseline ID, selection and artifacts
refer to the matching baseline actually used for the economic comparison.
The original ranking baseline remains separately identified as
`ranking_baseline_run_id` and in the retained portfolio context.
Repeating an identical build reopens its retained edition. Independent
alternatives retain the peer's availability handling.


## Command-line operations in the integrated application

The original Workspace CLI exposes the same actions as the operator. Run
from the application directory, using the retained study and a JSON
selection file containing its actual IDs:

~~~bash
python -B -m model.cli --workspace /absolute/upper-savannah-study planning-inventory-build /absolute/inventory-selection.json
python -B -m model.cli --workspace /absolute/upper-savannah-study portfolio-preview /absolute/portfolio-selection.json
python -B -m model.cli --workspace /absolute/upper-savannah-study portfolio-save /absolute/portfolio-selection.json
python -B -m model.cli --workspace /absolute/upper-savannah-study portfolio-run /absolute/portfolio-treatment.json
python -B -m model.cli --workspace /absolute/upper-savannah-study portfolio-report /absolute/portfolio-report-selection.json
python -B -m model.cli --workspace /absolute/upper-savannah-study portfolio-decision /absolute/portfolio-decision-selection.json
~~~

`portfolio-scenario` retains the selected geometry and treatment without
starting a run; `portfolio-run-prepare` prepares its native run. The
`portfolio-run` operation prepares and executes the same original model
run. The report and decision selections use the saved `portfolio_id` and
completed `evaluation_run_id`; the decision selection can choose the
paired baseline and an existing completed comparison.

The integrated navigation also contains **Scenario analysis** for comparing
whole alternatives, fixed-scale priorities, planning areas and weight
sensitivity. **Conservation portfolios** selects and models an explicit
set of parcels. Its economic decision action carries that modeled set into
the complete offline decision desk. The original workspace backup includes
all retained selections, actual inputs, model outputs and application
source needed to reopen the study.


## Original raster precision and coverage

Planning inventories made with common-valid-original-polygons/2 retain each
raw alternative-minus-baseline feature sum and its numeric encoding bound.
The bound sums half an ULP for each baseline and alternative retained annual
mass cell in its actual raster dtype on the identical common-valid support,
plus a conservative float64 accumulation bound. Portfolio scoring treats a
change within that bound as zero before normalizing weights; CSV and JSON
retain the original physical difference, the bound and adjusted scoring value.
This describes numeric resolution, not ecological uncertainty. Previous
inventory editions remain readable with their original method and identities.

The original Gura receiving command defaults explicitly to 90% minimum common
valid coverage. The five release subwatersheds retain measured coverage in
the inventory; all physical summaries still use their original common-valid
cells. A caller may supply a different --min-coverage. The previous 95%
threshold excluded the three agricultural subwatersheds in the actual original
Gura data (94.11–94.67% common valid coverage) while admitting unchanged forest
units. No missing cell is filled or counted as a modeled value.


## Actual selected treatment in a completed portfolio

The native portfolio evaluation now carries the original run's retained
land-cover accounting into its existing HTML report, evaluation JSON,
`treatment-footprint.json` and `treatment-footprint.csv`. These files travel
in the same portfolio report ZIP and appear in its ordinary file catalogue.
Building this report reads the saved stage and verifies its retained categorical
raster; it does not compile another scenario or execute NDR/SDR.

For each ordered patch, the report shows the original mask source, source and
destination classes, valid mask cells, eligible cells, actual changed assignments,
hectares and final-owned cells. Eligibility uses the values after preceding
patches. Changed assignments may overlap; only final-owned cells sum to unique
final differences from the baseline. Area uses the retained grid's affine pixel
area. The original source selection, patch transitions and complete retained
edit records remain in the JSON.

A zero result distinguishes a mask with no valid model-grid pixel centres,
a mask containing none of the declared source classes, and a patch assigning
its existing destination value. A final net count of zero explicitly says the
selected treatment left the categorical inputs unchanged. Missing accounting
in an older stage stays unavailable; the report does not infer a footprint
from annual exports or add overlapping patch areas. Native annual export
changes retain their original common-valid comparison support and units.

Report content includes this footprint in its immutable identity, so a newly
built report keeps an earlier report edition intact. The Gura planning receiver
also saves the byte-exact prior planning journal under
`gura-receiving/planning-report-continuations/<sha256>.json` before updating
its active state. The new state points to that original snapshot. Thus the
explicit 90% coverage continuation preserves the historical 95% report,
original selections, completed native runs and their earlier saved outcome.

Use the existing `portfolio-report` CLI or **Build report** action with the
saved portfolio and evaluation run to expose its actual retained treatment;
use the current original Gura operation to continue the corrected planning
selection. Existing completed stages remain reusable by the native engine.
