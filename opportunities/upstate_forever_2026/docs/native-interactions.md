# Native conservation action interactions

This component evaluates combinations of retained conservation actions through the application's original native NDR/SDR runner. It produces combined benefits, standalone benefits, pair nonadditivity and action allocations for the whole reporting area and, optionally, actual retained management-unit polygons.

## Selection and execution

Choose one retained baseline run and at least two actions. Each action refers to a saved land-cover scenario and optionally a nonempty list of its patch indexes. The action list establishes one global application order. Baseline patches run first. Every coalition then applies its selected actions in that same global order. Within an action, the selected patch indexes retain their explicit order.

When patch_indexes is omitted and the baseline has no patches, every action patch is selected. When the baseline already has edits, the action scenario must begin with the same retained baseline patch sequence; only its additional suffix becomes the action. Prefix equivalence uses actual mask bytes and native relative reader layout, effective layer, source-class predicate, attribute selection, destination class and all remaining computational patch fields. Reasons and titles do not alter equivalence. The resolved patch indexes are retained in the plan. A scenario containing only the existing baseline is rejected.

A non-prefix alternative requires explicit patch_indexes. Explicitly selected indexes keep their stated intent and order, allowing independent delta actions against an edited baseline without repeating full alternatives accidentally. For baseline [A] and full alternatives [A,B] and [A,C], the default combined application is [A,B,C].

An action's scenario supplies its patch definitions and retained mask sources. The action scenario supplies no replacement grid, profile or model stages. Derived coalition runs preserve the baseline's actual grid ID, profile ID and selected native model scope. Existing prepared cases reopen their saved run IDs and original requested software declarations; only new cases use the current Workspace preparation. Before scientific reduction, every completed coalition must have the same effective execution version for each selected native model. NDR and SDR may retain different versions within a run when the same per-model combination is present across every coalition. The original requested declarations remain visible.

Source masks may come from different collections. Preparation creates a mask-only retained collection containing exact original body and companion descriptors. Each original collection/source pair gets a unique source ID. A deterministic composed-source manifest is retained through the original object store and exposed as the collection's original_manifest; its captured_at is the saved operation's creation time. Relative native-reader paths are preserved, including sidecars. Original sources, scenarios, profiles and runs remain available.

Masks may be retained vectors or aligned binary rasters. Raster masks select valid cells whose value is one; zero and mask NoData select nothing. They do not accept vector layer or attribute filters. The original native scenario kernel checks the exact single-band grid, projected coordinate system, affine transform, dimensions, numeric type and valid zero/one values. The complete retained body and companion descriptors travel with the composed source collection; no resampling or second mask interpreter is introduced.

The original scenario kernel determines each patch's effect. Its from_codes predicate reads values left by preceding patches; later edits can overwrite or reverse earlier edits. Native NoData remains NoData. A different global action order is a different management design and must be saved as a separate plan.

The public functions in model.native_interactions are:

| Function | Result |
| --- | --- |
| preview(workspace, selection) | Case count, frozen application order, original selected models and preview metadata |
| save_plan(workspace, selection) | Immutable plan with source, scenario, profile and grid snapshots |
| get_plan(workspace, plan_id) | Saved plan fields at the top level, plus current state |
| list_plans(workspace) | Flat catalog summaries sorted by update time and ID |
| apply_plan(workspace, plan_id, run_models=False, workers=1, reuse_source_run_ids=None) | Resumable preparation; optional original native execution and analysis; workers and donors are keyword-only execution options |
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

Preparation validates the immutable snapshots and recreates every case's exact selected scenario. Existing checkpoints reopen their original run identity and saved declaration, checking the scenario, grid, profile and model scope against the immutable plan. Only missing cases call the current native preparation. Resuming prepares missing cases and reuses completed retained runs. Native execution calls Workspace.run, preserving its original stage cache and signature execution slot. Coalitions with identical compiled land-cover inputs can therefore reuse matching native model stages.

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

The operator sees the current active case, latest emitted progress and exact completed-case count. Individual case status rows are a phase-boundary snapshot, with the active case overlaid; case_status_snapshot_at identifies that snapshot. Original native run records remain authoritative. Resume reconstructs every expected scenario from the immutable plan, reopens and verifies retained run selections, and refreshes case statuses from those actual runs. A process interrupted between progress emissions therefore retains its prepared/native work without requiring a full growing case-map rewrite after every operation.

Completed native cases are grouped by run ID once and update the completion count incrementally. Shared finite support is intersected in batches of at most sixteen verified open native rasters. Each batch reads and writes the shared mask once per window, instead of repeating a complete mask pass for each pollutant/coalition raster. Cells already excluded from the intersection need no further values within that window. Every input still receives exact grid checks, and annual mass accounting reads its actual finite values independently afterward.

The scientific design, native run identities, output units, support predicate and allocation equations are unchanged by checkpoint coalescing or batched intersection.

CSV files protect string cells beginning with spreadsheet formula/control characters by prefixing an apostrophe. Numeric negative values remain numeric and retain their sign. Exact source/action identifiers remain available in result JSON and the GeoPackage for programmatic joins.



## Process dispatch and original native reuse

An apply operation accepts a keyword-only workers count, defaulting to one. It is a positive execution resource choice and is not part of the scientific plan or native run identity. The effective count is at most the number of incomplete distinct native run IDs. Source collection composition, case preparation, snapshot checks, common-support analysis and result publication remain serial under the parent operation's existing plan lock.

With multiple workers, model.interaction_dispatch creates a reusable ProcessPoolExecutor using multiprocessing's spawn context. Each child opens the existing Workspace from its root path and runs one original retained ID. Workspace instances, log handlers, GIS objects and model arrays are never passed between processes. The current native runner changes process-global logging state, so model calculations are isolated in processes.

Parallel dispatch requires the maintained native execution_slot API. Its scientific input signature lock serializes production of matching native stages, and its cache recovery is checked after acquiring that lock. The dispatcher consumes this existing mechanism; it does not create a second cache or replace the shared runner. The current original argument builder uses n_workers=-1 for each model's internal TaskGraph. The outer worker count controls simultaneous retained native runs; choose it for the receiving host's available resources.

Dispatch order prioritizes the empty baseline, full combination, standalone actions, pairs and then remaining subsets by cardinality. This makes useful actual baseline/combined cases available early. It changes neither the set of coalitions nor their fixed global raster edit order. Completed original runs are skipped, and the shared native cache handles matching physical stages.

Optional reuse_source_run_ids selects explicit original native stage donors through Workspace.run. These IDs are execution choices outside the retained scientific selection. Omitting the option preserves each original run's retained donor selection; an explicit empty list clears it on the current runner. A target run is excluded from its own donor list. The dispatcher does not add every previously completed case as an explicit donor, because doing so would turn cache selection into another growing all-pairs search. Normal indexed cache reuse remains available without an explicit donor list.

Each child returns a small completion/error message. The parent reopens the actual retained run.json, verifies its immutable selection against the prepared case and counts completion only when that record is complete. A future's successful return is not itself a physical result. Original selected-model exports are verified again by the common-support analysis.

If another operation already owns an original run lock, a worker waits for that operation's actual completion. If its owner exits, the same retained run can resume with its completed native stages. An individual failed native case records its actual error while independent scheduled cases continue.

If a child dies or the process pool breaks, the parent reconstructs available outcomes from the retained run records, cancels work that has not started, and persists a failed/interrupted orchestration state. Existing run IDs and stage journals remain available. Already running workers may finish their original records; a resumed dispatcher waits on their original locks instead of creating replacement run IDs or assuming the prior process failed to produce anything.

Execution progress includes requested/effective workers, serial/spawn mode, submitted/finished runs, skipped completed runs and original/reused completed stage-record counts. Those stage counts describe retained lineage, not a measured runtime saving. active_cases exposes each currently dispatched coalition's actual native phase, model, process ID, host and submission time; completed_cases keeps its aggregate meaning. The existing active_case field mirrors the first active entry for older clients.

Examples using an existing retained plan:

    python -m model.native_interactions_cli --workspace WORKSPACE apply PLAN_ID --run-models --workers 2
    python -m model.native_interactions_cli --workspace WORKSPACE apply PLAN_ID --run-models --workers 2 --reuse-runs donor-run-ids.json

Preparation alone creates no process pool. Analyzing already completed cases creates no process pool. Both use the same scientific outputs regardless of the worker count that produced their retained runs.

## Executed model provenance and historical results

The shared `model.native_versions` resolver uses each completed model stage's retained runtime first, the observed run runtime when that stage record is absent, then an explicitly labeled historical requested-version fallback. It retains the model, effective version, each original declaration, stage completion time and complete reuse ancestry. A missing effective version or any per-model mismatch among coalitions stops analysis before shared-support rasters or annual sums are created. The existing completed-stage and full annual-output checks still apply.

Every newly produced result includes `native_versions` with the shared resolver's `policy`, `models`, `versions` and per-run `runs` records. The native-run index download includes each case's corresponding model provenance. `native_version_binding` distinguishes `legacy_requested_equivalent` from `executed_model_cohort`.

When every coalition has the same original requested declaration and each selected model's effective execution version agrees with that declaration, the original analysis selection and ID remain byte-for-byte unchanged. Existing completed results reopen without rerunning reductions. If actual stage versions differ from the declarations, or declarations differ across an otherwise compatible executed cohort, the complete resolved provenance enters `selection.native_versions` and produces a separate result identity. Original results and artifacts remain available. A requested-version difference by itself does not reject completed, execution-compatible cases.

Historical result files without frozen runtime provenance retain their original shape. Opening a saved result validates its identity and retained files; it does not reconstruct a historical execution record from later metadata or require old source-run directories. New frozen provenance must agree with its bound selection, model scope, case declarations and native-run index. Reanalyzing a plan resolves the actual completed runs again before selecting the matching result identity.

The complete install includes the ten component files plus the shared `model/native_versions.py` dependency. The installer retains an existing shared resolver that exposes the required public API, recording its actual bytes in the installation receipt; a fresh installation receives the exact authored dependency. It never replaces that shared resolver with a component-specific implementation.
