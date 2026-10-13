# Sampling recommendations in the existing Monitoring application

This component turns an already saved observed context into an editable proposed sampling programme. It retains the exact original observations, station identities, source edition, analytical cohorts, historical period, calendar and network. It uses the maintained Monitoring solver for an explicitly requested future design. It adds no observations and no second solver.

## Operator course

1. Open **Sampling priorities**, choose a saved observed context and inspect its original source period, source station matches and exact analytical cohorts. The source picker exposes the currently retained context; it does not issue a public-data request.
2. Enter the programme title, person recording the proposal, actual recording timestamp and planning rationale. Select an evidence window contained within the source's published period.
3. Add a target with an original station and an exact retained cohort. Choose months, a historical minimum of distinct observation dates per month, and a separate proposed number of future visits. The historical minimum applies across the selected evidence window, not separately to every year. The report exposes the dates and years so the interpretation stays inspectable.
4. Enter any proposed reporting-limit target in the unchanged cohort unit, with its explicit rationale. Unknown original reporting limits and incompatible limit units stay visible. No censored value is replaced with zero, half a limit or a generated concentration.
5. Choose any-flow or high-flow intent. Historical event coverage applies only when the retained source explicitly declares the same station and period as the gauge. Nearby stations do not inherit that flow. Future fixed dates do not guarantee a storm.
6. Enter setup and per-visit costs as exact USD decimal strings, or leave them unknown. Zero is an explicit zero. State the cost source or operator assumption. The proposal sums each included target separately; overlapping visits are not automatically discounted.
7. Preview complete station/month support, original observation IDs and rows, reporting limits, source warnings and the proposed budget. Priority is an operator ranking; it is not calculated information gain. Optional sensitivity context is attributed prose, not an inferred match to an unrelated model.
8. Save the immutable proposal. Editing a saved proposal creates a child edition using its exact native ID; the original remains available. The source context is fixed within one proposal family.
9. To request a native design, supply the complete native configuration and include the selected targets' catchments in its explicit required_ids. Resolve unbound stations and multiple stations assigned to one catchment first. Unknown proposal costs may remain unknown when the native configuration supplies its own complete explicit costs; the two budgets stay separate. Set a future calendar after the historical evidence window, with the actual budget, costs, visit lengths, crews and dates. The unchanged native solver owns feasibility, calendar capacity and geographic objective.
10. Read the returned native plan and each target's actual selected-month visit count. The native design has its own entered budget and cost table, shown separately from the itemized proposal estimate. Laboratory analyte/limit requirements and event-triggered work remain explicit planned scope. Creating a plan creates no collected field event.
11. Export the complete proposal bundle, open its readable report and CSVs, and inspect the exact original source files. For an independently editable receiving application, export the original complete Study/Workspace through the current application and reopen that archive. The report ZIP is not a replacement Workspace.

## Model API

All functions are in model.monitoring_recommendations.

- catalog(workspace): observed-context summaries and saved proposal summaries.
- context(workspace, context_id): exact source/station/cohort catalogue. design_configuration is the original saved plan's unchanged configuration when available, otherwise null.
- preview(workspace, *, selection): compute the full proposal without writing.
- prepare(workspace, *, selection, operation_id, parent_id=None, expected_parent_digest=None): save an immutable proposal. For a successor set both parent_id and expected_parent_digest to the exact native parent.id.
- inspect(workspace, recommendation_id): reopen and compare the complete saved calculation with its retained context.
- list_saved(workspace), history(workspace, recommendation_id), designs(workspace, recommendation_id), inspect_design(workspace, design_id).
- design(workspace, *, recommendation_id, configuration, operation_id, title=None): run the original monitoring_design.solve_design and retain the exact plan/result.
- report_html(record, native_designs=None): complete readable report.
- export_members(workspace, recommendation_id): streamable complete-member descriptors for source/package composition.
- export_recommendations(workspace, *, recommendation_id, export_root=None): original file-ticket-compatible path/bytes/SHA result.
- verify_workspace(workspace): inspect retained proposals and native design/source identities.
- compile_recommendations(record, selection): pure calculation from an already inspected full context; useful to a source-native receiving course.

## Exact selection shape

selection contains context_id, title, operator, recorded_at (ISO timestamp with timezone), evidence_start/evidence_end (YYYY-MM-DD), notes, planning_basis and targets.

Every target has:

| Field | Meaning |
|---|---|
| id | Stable explicit target ID, unique within the proposal |
| station_id | Exact source_station_id from the context |
| cohort_id | Exact cohort ID from the context catalogue |
| months | Nonempty distinct integers 1–12 |
| minimum_dates_per_month | Nonnegative historical date-count goal across the selected evidence window |
| proposed_visits | Nonnegative future planning count |
| reporting_limit | Null or nonnegative exact decimal string in the cohort's original unit |
| reporting_limit_basis | Explicit scientific/operator rationale |
| flow_goal | any or high_flow |
| reason | Concrete purpose of the target |
| priority | Operator-entered integer 1–5 |
| included | Boolean; excluded targets remain saved and visible |
| setup_cost / per_visit_cost | Null or exact USD amount string, at most two decimal places |
| cost_basis | Published source or explicit operator planning assumption |
| sensitivity_basis | Optional source-qualified narrative; no automatic information-gain calculation |

Cohort identity retains both field presence and value. Missing, null and empty metadata remain distinct. Characteristic, method, unit, fraction, value type, speciation and available method/media/depth/project metadata participate. Original concentration values and source record IDs do not split a cohort; every original row remains retained.

Output targets preserve their full input under target, the original station match, complete cohort fields, original evidence rows and IDs, monthly gaps, reporting-limit comparisons, exact flow applicability, itemized costs and warnings. The top-level gaps array is the complete monthly table. budget splits known_total_cents from unknown_target_ids. handoff preserves required_catchment_ids, unbound_target_ids, station_binding_conflicts, station_bindings and complete included requirements.

## Native persistence and retries

Immutable collections:

- monitoring_recommendations: source-bound proposal editions and parent ancestry.
- monitoring_recommendation_designs: proposal-to-original-native-plan selections/results.
- monitoring_plans: existing authoritative solver plans.

The small monitoring_recommendation_operations index is operation recovery, not a second scientific store. Exact retries return the original immutable result. Reusing an operation ID for another payload fails. Interrupted publication after an immutable save is recovered by the original operation marker. Native solver plans retain their recommendation operation/fingerprint so a crash before the result index does not repeat the solved design.

The original Workspace _save/_get methods own content addressing. The source context, network and plan are checked through their maintained original readers. No live source, running worker, original observation or old plan is overwritten.

## Native CLI

From the existing application root, use its compatible GIS Python:

    GIS_PYTHON -m model.monitoring_recommendations --workspace WORKSPACE catalog --output catalog.json
    GIS_PYTHON -m model.monitoring_recommendations --workspace WORKSPACE context --request context-request.json --output context.json
    GIS_PYTHON -m model.monitoring_recommendations --workspace WORKSPACE preview --request preview-request.json --output preview.json
    GIS_PYTHON -m model.monitoring_recommendations --workspace WORKSPACE prepare --request prepare-request.json --output saved.json
    GIS_PYTHON -m model.monitoring_recommendations --workspace WORKSPACE design --request design-request.json --output design.json
    GIS_PYTHON -m model.monitoring_recommendations --workspace WORKSPACE export --request export-request.json --output export.json

Request JSON uses the same named keyword arguments as the functions. The existing queued operator injects its actual task ID as operation_id. It preserves one operation across response loss and reload.

## Complete producing and receiving course

Use one actual retained context in the original received application; prefer the physically received Eighteenmile source cohort where already admitted. Do not manufacture an observed source to make the screen populated. If the source has not yet been bound to a saved network, use the existing context intake and exact original station mapping first.

Create an explicitly authored proposal using those real rows. Inspect one fully observed station/cohort and one month with no retained match; choose costs and goals as visibly authored planning assumptions. Save it, change a target, save a child edition and reopen both. Repeat the identical save operation and confirm the same immutable ID; a different payload under that operation must not create a new proposal.

Request a native design using the retained network and complete explicit future configuration. Read the original solver status, cost, selected catchments and calendar, alongside target-specific future counts. If infeasible, retain the actual result and make an explicit revised selection/configuration; do not disguise it as a successful calendar.

Operate the current application at desktop and390px, personally inspect both views, and use source selection, target edits, preview/save, saved history, design, report/export and fresh reopening. Open every generated HTML/CSV/JSON/source attachment and the full exported archive. Resolve actual visible errors in this same source. Preserve all existing scientific runs, the actual equipped receiving owner and the current AGENTS.md / CURRENT_OWNER_DIRECTION.md instructions. Warm correspondence remains with its original owner and Bryce's exact-message authorization.

Return the real runtime/source paths, exact saved context/proposal/design IDs, current source head, native result and actual rendered files to ECO-SAMPLING-15227-20261013 in the original Eco thread. Source construction and a retained Git blob alone are not a claim that this native course ran.

## One complete same-operation native course

The maintained source_tools/receive_sampling_recommendations.py accepts the exact authored inputs, executes the existing solver, exports the source-bound report and selected Study, restores it through model.portable.resume_restore and independently reopens the same complete proposal/design. It then recovers the original save operation from the immutable records in that fresh Workspace. Its output is outside the live Workspace and exact input files are preserved before work.

    GIS_PYTHON source_tools/receive_sampling_recommendations.py --workspace WORKSPACE --selection SELECTION.json --successor-selection SUCCESSOR.json --design-configuration NATIVE_CONFIGURATION.json --operation-id ECO-SAMPLING-15227-COURSE --output NEW_OPERATION_DIRECTORY

The successor input is optional; all other arguments select the real existing source and explicit planning intent. An infeasible native result remains an actual result. This command creates no historical observations, sends no message and starts no replacement server. Complete GUI and attachment operation follows in the same received application.
