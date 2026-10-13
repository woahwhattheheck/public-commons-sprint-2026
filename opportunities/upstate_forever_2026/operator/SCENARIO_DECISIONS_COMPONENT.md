# Scenario decisions workbench

Dependency-free ES module and scoped neutral CSS for the retained-run operator. The module computes and presents downstream comparisons. Model execution, parameter sensitivity, paired raster production and optimization remain upstream.

## Files and public API

- operator/web/scenario_decisions.mjs — named exports VERSION, DEFAULT_METRICS, compute, toJSON, toCSV, toCSVChunks, toText, toTextChunks, mount, attachScenarioDecisions.
- operator/web/scenario_decisions.css — scoped styles; no external fonts, icons or color dependencies.

Import the CSS in the operator document. Import mount or attachScenarioDecisions from the ES module. mount(container, data, options) returns setData, setState, getState, getComparison, getTableView, exportJSON, exportCSV, exportText, destroy.

Options:
- initialState: saved complete view state.
- onChange(state, comparison): invoked after initial render and changes, including new data. State is a copy. The comparison is also copied unless notifyAssessment:false is selected; retain state pending explicit host save.
- notifyAssessment:false: omit the optional comparison callback argument to avoid copying the complete assessment during page/search/pin changes. The default preserves the original two-copy callback contract. getComparison and complete exports remain available.
- onExport({format, filename, content, type}): optional host export handler. content remains a complete string. Without it the browser downloads CSV and text from their chunk generators, avoiding construction of an additional joined export string.
- onError(error): optional host notification if onChange fails.

attachScenarioDecisions({container, data, initialState, onChange, onExport, onError, notifyAssessment}) is the same mount through an object argument.

The component performs no fetches, model runs, uploads or mutations. Root integration supplies retained data and persists the complete state using its existing operator action/API. Buttons use component-owned listeners and no generic data-action attributes; click/change/input events stop bubbling at the panel boundary.

## Adapter input

Top-level:
- workspace_id: retained workspace identity.
- metrics: array of {id, label, unit, nonnegative?}. Default ids are nitrogen_export, phosphorus_export, sediment_export. Nitrogen and phosphorus total units are kg/year; sediment totals are metric_tonnes/year. Set nonnegative:true for mass exports when supplying your own definitions.
- alternatives: any number of retained alternatives, including selectable baseline runs.

Each alternative:
- id: unique component selection identity, normally retained run id.
- label, run_id, grid_id, profile_id, scenario_id, invest_version.
- domain_id: exact comparable model/reporting domain.
- period_id: explicit temporal basis. A same-grid annual model may use annual-model:<retained-grid-id>; this is a model period, not a calendar-year assertion.
- year: optional actual calendar-year metadata. Never manufacture one. If supplied it must agree between summaries for total comparisons.
- summaries: reporting-summary array.

Each summary:
- catchment_id: stable scope-selection key (whole domain, HUC or utility scope).
- label: optional display label.
- scope_id: exact reporting-boundary/aggregation-definition identity.
- domain_id, period_id, year: optional per-summary overrides of the alternative.
- support_id: optional shared exact valid-cell/area support identity.
- valid_cells: optional count.
- metrics: keyed measurement objects.
- direct_changes: optional keyed retained native difference objects.

Each measurement:
- value: finite numeric annual total, or null for NoData. Strings, NaN, infinity and empty fields never become zero.
- unit: explicit annual-total unit. Pixel output units must not be passed as total units.
- status: absent, valid or ok accepts finite values; other statuses exclude the total and preserve a NoData state.
- support_id: exact support identity, optionally overriding summary support_id.
- valid_cells: optional nonnegative integer; zero valid cells is NoData.

Each direct_changes[metric_id]:
- value: retained signed alternative-minus-baseline native sum_change.
- unit: annual-total unit.
- direction: exactly "alternative minus baseline".
- baseline_run_id: actual native difference baseline run; must equal the selected baseline's run_id.
- alternative_run_id: optional explicit run check.
- valid_cells: native difference intersection count.
- support_id, artifact_path, artifact_sha256: optional retained provenance.
- status: optional valid/ok status.

Existing native adapter:
1. Retained run.artifacts[metric] provides sum and sum_units for measurement.value and measurement.unit. units/native_units may be per-pixel; do not use those for annual totals.
2. Native comparison artifacts provide sum_change and valid_cells. Copy the comparison baseline_run_id, direction, artifact path/hash and annual units to direct_changes.
3. The difference routine uses the intersection of valid masks on the common grid. Where |baseline| = |alternative| = |baseline intersection alternative|, the masks are identical. The adapter may assign the SAME support identity to the matching baseline and alternative measurement for that metric.
4. Equal baseline/alternative counts alone are insufficient. If the three-count proof does not hold, preserve their direct native difference and leave total-support identity different or absent. The panel still displays the retained physical delta; percentage and multi-criterion comparisons exclude that total pair.
5. Paired catchment outputs can supply richer exact matching support and matching baseline/alternative totals directly. No code change is required.

The panel never infers equal support from counts by itself, never imputes missing totals and never invents reporting boundaries. It also checks differing known valid-cell counts even when supplied support ids match.

## Calculation semantics

- Total comparison requires both numeric measurements in the configured unit, matching nonempty domain_id, scope_id and period_id, matching year metadata, and matching nonempty exact support ids.
- Delta = alternative total minus baseline total.
- Reduction = baseline total minus alternative total.
- Percent reduction = 100 * (baseline - alternative) / baseline. Zero baseline yields null and zero_baseline status, including the 0-to-0 case.
- If totals are not comparable but the native retained difference identifies this baseline and has valid units/direction/context, delta remains its retained sum_change. delta_basis is retained_intersection_difference. Percentage remains undefined.
- On fully comparable totals, delta_basis is same_support_totals. The direct native artifact remains separately available in native_change.
- Summary failures become per-row exclusion reasons. The workspace still renders every selected alternative/metric/scope.
- Different profile ids remain eligible with a visible parameter-effect flag; model-version and grid-id changes also remain explicit. The result is not silently presented as a scenario-only causal effect.

Reporting scopes are independent. Nested or overlapping catchments are never summed.

## Explicit choice analysis

No preference direction or weight is supplied by default.

Pareto comparison requires a user-selected minimize/maximize direction for every selected metric and at least two alternatives whose totals are comparable for EVERY selected metric in that scope. It uses direct physical alternative outputs. An alternative dominates another only when it is no worse on all selected criteria and strictly better on one. Equal alternatives do not dominate one another.

Priority is off by default. The user supplies positive weights for included criteria and directions for weighted criteria; blank/zero weights contribute nothing. The candidate set remains the complete eligible set across ALL selected metrics. Weights normalize to sum to one. Each metric is min-max normalized over that candidate set, using its chosen direction. Constant criteria contribute zero. The 0–100 score and competition rank express those selected preferences only. The exact common alternative set, ranges, directions and raw/normalized weights are exported and shown in the method disclosure.

The baseline is a reference outside the candidate choice set. Priorities are never compared between reporting scopes. Changing the selected candidate set may change min-max scores. Search, sort, pins and table pages do not affect calculation membership.

## Complete persisted view state

{
  "baseline_id": "",
  "alternative_ids": [],
  "metric_ids": [],
  "catchment_ids": [],
  "directions": {},
  "priority": {"enabled": false, "weights": {}},
  "query": "",
  "status_filter": "all",
  "pinned_ids": [],
  "only_pinned": false,
  "sort_key": "alternative",
  "sort_direction": "asc",
  "table_page": 1,
  "table_page_size": 50,
  "method_catchment_id": ""
}

Directions: minimize | maximize | empty.
Status filter: all | comparable | excluded | native | undominated | dominated.
Sort key: alternative | catchment | metric | baseline | value | delta | percent | priority.
Sort direction: asc | desc.
Table page: one-based positive integer, clamped to available filtered pages.
Table page size: 25 | 50 | 100 | 250; default 50.
Method catchment id: one current reporting scope; a missing id resolves to the first currently available group.

setState patches the current view; directions and weight maps merge. Reopening a saved view into a new mount with initialState restores the complete saved state. setData preserves selections, adds initial selections when replacing an initially empty dataset, and removes ids no longer available. Newly added alternatives to an already populated view remain explicitly selectable.

Pinning moves every row for the chosen alternative above unpinned rows; "Pinned alternatives only" filters the view. Search, status filters, pins and sorting apply to the full comparison before slicing the selected page. Changing a display filter, sort or page size through the UI resets to page one. Saved page positions are clamped after data changes. The selected scenario/metric/scope membership always determines scientific calculation, independently of the visible page. Missing numeric values remain last in both sort directions. All source labels and identities enter the DOM as text, never HTML.

## Exports

compute(data, selection) returns schema scenario-decisions.comparison.v1 with exact selection, baseline metadata, metric definitions, scope groups, rows, exclusions, native changes, priority normalization and method conventions.

toJSON(comparison), toCSV(comparison), toText(comparison) export the actual computed comparison. UI JSON also includes view_state. Exports cover every selected row, including excluded rows; they do not silently narrow to table search results. JSON null and empty CSV values represent missing/undefined quantities, while real zero remains numeric zero. CSV neutralizes formula-like source strings. Display formatting rounds to seven significant digits; exports preserve JavaScript number precision.

Accessible text is a complete plain-text report with baseline/alternative provenance, reporting context, actual values, differences, exclusions and choice calculations. Keyboard users have native controls, focus indicators, labeled pin states, sortable headers, a table caption, live row status and a focusable scroll region. Page controls above and below the table expose first/previous/next/last, page number, current row interval and total matching row count. Boundary navigation retains keyboard focus. Each displayed row retains its physical unit, reporting domain/period and run/grid/profile/scenario identities.

The method disclosure renders one reporting scope on demand, showing its complete eligible alternative ID list, directions, raw/normalized weights and actual cohort ranges. Zero-weight selected metrics remain visible and still determine completeness. Full method details for every scope remain in the assessment and exports. Printing renders the current table page; full Export text or CSV covers every selected row.

getTableView() returns inexpensive display metadata: page, page_size, page_count, total_rows, filtered_rows, shown_rows, first_row, last_row, selected_alternatives, selected_catchments and the current page's row_keys. Row counts count metric comparisons; scenario and scope counts are separate. This method does not clone the full assessment.

## Focused verification

One executed behavior check passed 12 assertions covering physical sign and percentage, zero baseline, missing values, retained partial-support difference, common candidate set, Pareto dominance/tradeoffs, explicit weighted scores, profile-change flag, CSV safety, exact export content and preservation of input data. This was a component calculation check. Browser rendering and host API wiring belong to integration; no browser runtime was exposed in the component-building seat.


## Large-cohort behavior in version 1.1

The original calculation check above was preserved. One additional focused large-cohort check exercises 121 retained-run-shaped records, 120 alternatives, 80 reporting scopes and 3 metrics (28,800 comparison rows). It verifies bounded DOM pages, global filtering/sorting/pins, saved-page clamping, complete cohort/range/choice preservation, lazy scope-method details, all-row JSON/CSV/text exports and lightweight notifications. Source: operator/web/scenario_decisions.performance.check.mjs. Measured results and receiving-browser steps are in operator/SCENARIO_DECISIONS_PERFORMANCE.md.


## Complete export serialization, version 1.1.1

The added toCSVChunks(comparison) and toTextChunks(comparison) exports are synchronous string generators. Concatenating their yielded strings produces exactly the existing CSV or accessible-text format, including line endings, complete cohort IDs, physical units, provenance and exclusions. The original toCSV and toText functions still return complete strings; getComparison and JSON retain their existing schemas.

CSV yields the original header and batches of at most 256 comparison rows. A scope's complete CSV-escaped eligible cohort field is prepared once and reused in its rows. Accessible text indexes rows by reporting scope once and emits the original heading and scope sections. Default browser CSV/text downloads pass these generators to Blob. This limits temporary construction during those downloads; the required exported contents remain complete. Custom onExport handlers continue to receive the complete string for compatibility.

Neither generator applies display filters or pagination. Scientific calculation, common-cohort membership, weights, directions, min/max ranges, Pareto results and scores are unchanged. The performance guide records the single focused large-cohort byte-parity and serialization measurement.
