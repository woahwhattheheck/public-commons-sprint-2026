# Native conservation action interactions

This component evaluates combinations of retained conservation actions through the application's original native NDR/SDR runner. It produces combined benefits, standalone benefits, pair nonadditivity and action allocations for the whole reporting area and, optionally, actual retained management-unit polygons.

## Selection and execution

Choose one retained baseline run and at least two actions. Each action refers to a saved land-cover scenario and optionally a nonempty list of its patch indexes. The action list establishes one global application order. Baseline patches run first. Every coalition then applies its selected actions in that same global order. Within an action, the selected patch indexes retain their explicit order.

When patch_indexes is omitted and the baseline has no patches, every action patch is selected. When the baseline already has edits, the action scenario must begin with the same retained baseline patch sequence; only its additional suffix becomes the action. Prefix equivalence uses actual mask bytes and native relative reader layout, effective layer, source-class predicate, attribute selection, destination class and all remaining computational patch fields. Reasons and titles do not alter equivalence. The resolved patch indexes are retained in the plan. A scenario containing only the existing baseline is rejected.

A non-prefix alternative requires explicit patch_indexes. Explicitly selected indexes keep their stated intent and order, allowing independent delta actions against an edited baseline without repeating full alternatives accidentally. For baseline [A] and full alternatives [A,B] and [A,C], the default combined application is [A,B,C].

An action's scenario supplies its patch definitions and retained mask sources. The action scenario supplies no replacement grid, profile or model stages. Derived coalition runs preserve the baseline's actual grid ID, profile ID, selected model list when present, and InVEST version. This makes the modeled difference attributable to the selected ordered land-cover edits under that retained model configuration.

Source masks may come from different collections. Preparation creates a mask-only retained collection containing exact original body and companion descriptors. Each original collection/source pair gets a unique source ID. A deterministic composed-source manifest is retained through the original object store and exposed as the collection's original_manifest; its captured_at is the saved operation's creation time. Relative native-reader paths are preserved, including sidecars. Original sources, scenarios, profiles and runs remain available.

The original scenario kernel determines each patch's effect. Its from_codes predicate reads values left by preceding patches; later edits can overwrite or reverse earlier edits. Native NoData remains NoData. A different global action order is a different management design and must be saved as a separate plan.

The public functions in model.native_interactions are:

| Function | Result |
| --- | --- |
| preview(workspace, selection) | Case count, frozen application order, original selected models and preview metadata |
| save_plan(workspace, selection) | Immutable plan with source, scenario, profile and grid snapshots |
| get_plan(workspace, plan_id) | Saved plan fields at the top level, plus current state |
| list_plans(workspace) | Flat catalog summaries sorted by update time and ID |
| apply_plan(workspace, plan_id, run_models=False) | Resumable preparation; optional original native execution and analysis |
| analyze_plan(workspace, plan_id) | Analysis of completed retained native cases without launching a model |
| get_result(workspace, result_id, verify=True) | Retained result with verified downloadable artifacts |

The selection fields are:

| Field | Meaning |
| --- | --- |
| title | Operator label |
| baseline_run_id | Actual retained run whose scenario is the empty-action case |
| actions | Ordered objects with id, scenario_id, optional title and optional patch_indexes |
| estimator | exact or permutation |
| permutations | Positive number of sampled permutations; default 128 |
| seed | Nonnegative integer fixing the sampled design; default 0 |
| max_cases | Explicit maximum number of distinct prepared native coalitions; default 4096 |
| include_pairwise | Include every two-action case and pair nonadditivity; default true |
| zones | Optional retained vector selection: source_collection_id, source_id, id_field, optional layer and where |

Preparation validates the immutable snapshots, recreates every case's exact selected scenario and run identity, and checks any existing checkpoint against that identity. Resuming prepares missing cases and reuses completed retained runs. Native execution calls Workspace.run, preserving its original stage cache. Coalitions with identical compiled land-cover inputs can therefore reuse matching native model stages.

A preparation call does not run physical models. Applying with run_models=True resumes native execution, records each case's failure separately, and continues other prepared cases. The plan reports failed if any native case failed. Reapplying retries incomplete cases. Analysis begins only when every case in the frozen design has completed.

## Exact and sampled designs

With n actions, exact attribution needs all 2^n coalitions, including the empty baseline and the full action set. The preview rejects a design that exceeds its explicit max_cases value. Operators can deliberately increase that value or select permutation sampling.

Permutation sampling freezes uniformly shuffled action-index permutations using the retained integer seed. It prepares the union of their prefix subsets, plus the empty set, full set, all singletons and, when requested, all pairs. Duplicate subsets share one native case.

A sampling permutation determines which marginal contributions enter the allocation calculation. It does not change raster edit order. Every subset is rendered in the single retained global action order. Consequently, the value of a subset is well-defined even where actions overlap or reverse one another.

## Physical outputs and shared area

Analysis reads only completed run artifacts named nitrogen_export, phosphorus_export and sediment_export. It verifies their retained hashes, exact annual mass units, actual CRS, affine transform, dimensions and selected model set. NDR selections require both nutrient artifacts; SDR selections require sediment. All coalitions must use the same selected set.

These run artifacts are already annual mass per pixel. The native runner has converted its per-hectare model outputs into kg/pixel/year for nitrogen and phosphorus and metric_tonnes/pixel/year for sediment. This component sums those mass values directly. It does not multiply them by pixel area again.

The physical support is the intersection of:

1. The retained reporting mask.
2. Valid, finite values in every selected mass artifact.
3. Every coalition in the frozen design.

The resulting binary shared-finite-support GeoTIFF is retained. Every pollutant, action, coalition and allocation in one analysis uses that same area. Comparisons therefore do not acquire an artificial gain from an updated or alternative output losing valid cells.

Actual cell area is the absolute determinant of the raster affine transform multiplied by the projected CRS linear-unit conversion squared. Hectares are used only for area reporting. Annual outcome units are kg/year for nitrogen and phosphorus, and metric_tonnes/year for sediment. The metrics remain separate.

For every coalition, metric and reporting scope, the result also records finite reporting cells excluded from the common support and their annual export. Those excluded masses do not enter benefits or action allocations. NoData is never replaced with zero. A zone with no shared finite cells has zero shared area, support_status=no_common_support, and null shared exports, benefits and allocations. If the entire reporting area has no shared finite cells, analysis raises a specific error and retains the failed checkpoint.

Results from two different saved designs can have different common support. Their support areas and masks must be checked before comparing aggregate benefits across those designs.

## Reporting zones

An optional zone selection uses the application's actual retained vector reader and its layer/where filtering. Zone IDs must be nonempty strings or integers. Features with the same ID are dissolved. Conflicting string/integer representations of the same ID are rejected.

Zone membership follows native pixel centres. Different dissolved zone IDs may not overlap at a native cell centre inside the reporting area; ambiguous additive membership raises an error. Zones can cover only part of the reporting area. The result records unassigned common cells, while its whole-reporting-area totals still include them.

A retained attribution-zones GeoTIFF maps source IDs to integer zone indexes. When zones are selected, a GeoPackage contains the actual dissolved source geometry and each zone/action/metric allocation, standalone benefit, sampling error and shared area. Its polygons describe the original reporting zones; its support_ha and valid_cells fields describe the finite native cells used inside them.

## Benefit and interaction definitions

Let E(S) be annual native export for coalition S on the shared support, and let E(empty) be the selected baseline export. Benefit is v(S) = E(empty) - E(S). A positive value means less modeled export. A negative value is retained as an increase.

Standalone benefit for action i is v({i}). Combined benefit is v(N), where N contains all actions. Combined nonadditivity is v(N) minus the sum of the standalone benefits.

For a pair i,j, pair nonadditivity is v({i,j}) - v({i}) - v({j}). The result separately reports the sum of all standalone pair terms and the remaining higher-order contribution. These pair terms describe effects relative to the empty baseline; they do not assign a pair's interaction equally across larger contexts.

For exact Shapley allocation, action i receives the sum over subsets S without i of:

    [E(S) - E(S union {i})] / [n * choose(n - 1, size(S))]

For sampled allocation, each retained random permutation contributes the marginal benefit at the point action i enters its prefix subset. The mean of these marginal benefits estimates that action's Shapley share. With at least two permutations, the reported standard error is the sample standard deviation of those marginal benefits divided by the square root of the sample count. With one sample, that standard error is null.

The sampling standard error concerns allocation over random permutations. It does not quantify model error, parameter uncertainty or uncertainty in the source data. Exact mode has no permutation sampling error, represented by null.

Both methods allocate the full coalition benefit. The retained allocation_efficiency_residual, also exposed as efficiency_residual in JSON summaries, reports combined benefit minus the sum of allocated action benefits. The expected residual is numerical rounding. Neither method assumes additivity, truncates negative contributions nor normalizes unlike pollutant units.

The interpretation is conditional on the retained model inputs, chosen actions, fixed edit order and common support. Shapley shares allocate that defined modeled coalition game; they do not by themselves establish a monetary return, a causal field measurement or the best constrained portfolio.

## Retained outputs and exports

Plans are immutable records in interaction-plans. Resumable states are stored under interactions/<plan_id>/state.json. Each actual analysis identity binds the plan, ordered native run selections, source zone selection, reporting mask and verified native artifact descriptors.

Complete results live under interaction-results/<result_id>. Reopening verifies the selection-derived identity and, by default, every retained artifact. The authenticated operator may request verify=False for routine rendering and issue the original download tickets, which verify each artifact when downloaded; CLI and analysis reuse keep verification enabled. The result includes:

- Whole-area and zonal summary rows.
- Every coalition's annual export and baseline-relative benefit.
- Every action's standalone benefit and allocated share.
- Pair nonadditivity and higher-order remainder.
- Common finite area, excluded coverage and excluded annual mass.
- Exact native run IDs, selections, model stages and artifact hashes.
- Shared-support and zone-index GeoTIFFs.
- Coalition, action, pair and summary CSV files.
- A native-run index JSON file.
- An actual-geometry zone attribution GeoPackage when zones are supplied.

A changed native artifact identity yields a different retained analysis result. Previous completed result IDs remain in state history when replaced. The standard workspace backup includes these application and workspace folders, so the existing project export preserves the coalition workflow together with its native dependencies.

## Command-line operation

All commands use an existing retained workspace. Use the operator's saved identifiers in the selection JSON; no source or native outcome is generated merely by describing an action.

    python -m model.native_interactions_cli --workspace WORKSPACE preview --selection selection.json
    python -m model.native_interactions_cli --workspace WORKSPACE plan --selection selection.json
    python -m model.native_interactions_cli --workspace WORKSPACE list
    python -m model.native_interactions_cli --workspace WORKSPACE show PLAN_ID
    python -m model.native_interactions_cli --workspace WORKSPACE apply PLAN_ID
    python -m model.native_interactions_cli --workspace WORKSPACE apply PLAN_ID --run-models
    python -m model.native_interactions_cli --workspace WORKSPACE analyze PLAN_ID
    python -m model.native_interactions_cli --workspace WORKSPACE result RESULT_ID --output result.json

The workspace and output options can appear before or after the subcommand. Selection '-' reads JSON from standard input. A failed native state returns exit code 1; an invalid command input or raised runtime error returns 2. The original retained checkpoint remains available for resumption.

## Throughput and interruption recovery

Native preparation retains each actual scenario and run through the original workspace APIs. The full coalition state is committed when its phase, operation state, result identity, source collection or failure count changes. These full checkpoints include the complete case map. Repeated progress within one phase writes a separate small progress record at most once every two seconds.

A monotonically increasing checkpoint_generation binds that progress record to its corresponding full state. Full state is atomically committed first. Readers ignore progress from an earlier generation; a catalog reads the compact progress record only when it is at least as new as the full state. This ordering prevents a previous phase's status from overwriting a newly committed phase or failure.

The operator sees the current active case, latest emitted progress and exact completed-case count. Individual case status rows are a phase-boundary snapshot, with the active case overlaid; case_status_snapshot_at identifies that snapshot. Original native run records remain authoritative. Resume reconstructs every expected scenario/run selection from the immutable plan, verifies any retained checkpoint identities and refreshes case statuses from those actual runs. A process interrupted between progress emissions therefore retains its prepared/native work without requiring a full growing case-map rewrite after every operation.

Completed native cases are grouped by run ID once and update the completion count incrementally. Shared finite support is intersected in batches of at most sixteen verified open native rasters. Each batch reads and writes the shared mask once per window, instead of repeating a complete mask pass for each pollutant/coalition raster. Cells already excluded from the intersection need no further values within that window. Every input still receives exact grid checks, and annual mass accounting reads its actual finite values independently afterward.

The scientific design, native run identities, output units, support predicate and allocation equations are unchanged by checkpoint coalescing or batched intersection.

CSV files protect string cells beginning with spreadsheet formula/control characters by prefixing an apostrophe. Numeric negative values remain numeric and retain their sign. Exact source/action identifiers remain available in result JSON and the GeoPackage for programmatic joins.

