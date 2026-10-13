# Source edition refresh

This component connects retained source editions to the profiles, scenarios, grids and native model runs that depend on them. It is additive to the cumulative Upper Savannah operator application.

## Entry points

- preview(workspace, selection): source differences and current dependency snapshot.
- save_plan(workspace, selection): immutable refresh plan, deduplicated by identity.
- get_plan(workspace, plan_id): complete plan plus state, or null before applying.
- list_plans(workspace): summaries suitable for the operator list.
- apply_plan(workspace, plan_id, run_models=False): remap and prepare dependent objects, resume checkpoints, optionally execute physical changes in the existing native engine.

Selection fields:

    {"from_collection_id":"<64-hex source collection ID>","to_collection_id":"<64-hex source collection ID>","source_id_map":{"previous-source-id":"replacement-source-id"},"title":"2026 source edition refresh"}

The two collections must already be imported. Source IDs present in both collections match automatically. Renamed source IDs require explicit mappings. Titles and roles are never used to guess a replacement.

## Immutable plans and resume

Plans use Workspace._save("source-refresh-plans", ...). Identity includes the two collection identities, differences and complete selected dependency snapshots. Identical planning calls deduplicate. An object created after saving a plan appears in a newly prepared plan.

Execution state is source-refresh/<plan_id>/state.json, protected by a per-plan lock. A checkpoint follows every saved profile, scenario, grid and run. Original objects are preserved. Reusing a checkpoint verifies the retained output against planned fields. Recreating a missing output must recover the same identity.

States: applying, prepared, complete, failed. Phases: profiles, scenarios, grids, runs, native, comparisons, done. The mappings object maps original IDs to replacement IDs in each dependency kind. run_results records original/replacement runs and required native reruns. comparison_results records completed, pending, incompatible and unavailable comparisons individually.

Native execution requires run_models=True. A failed native branch records its concrete error while independent branches continue. Reapplying the plan resumes retained work. Comparisons require completed original and refreshed runs with the same InVEST version; the existing native comparison implementation enforces additional spatial and numerical contracts.

## Difference semantics

Body SHA-256/byte counts and companion SHA-256/byte counts/filenames determine content changes. A main source filename extension change is computational metadata. Attribution and edition metadata are reported separately. Unit, CRS, scaling, resampling, band, layer, kind and other computational metadata require a native rerun. Unknown metadata is treated conservatively as computational.

Preview uses existing retained import-manifest fingerprints without rereading entire raster bodies. Apply invokes existing source validation, table inspection, grid preparation and native execution. It uses actual retained spatial inputs and model outputs.

Every physically affected NDR/SDR run uses its complete retained model domain. Reporting-area selections, model-domain selections, raster inputs, profile biophysical tables and scenario masks are traced. Lineage-only changes produce newly bound selections without redundant native execution.

## Command examples

    python -m model.source_refresh_cli --workspace /path/to/workspace preview --selection refresh-selection.json
    python -m model.source_refresh_cli --workspace /path/to/workspace plan --selection refresh-selection.json
    python -m model.source_refresh_cli --workspace /path/to/workspace apply <plan-id>
    python -m model.source_refresh_cli --workspace /path/to/workspace apply <plan-id> --run-models
    python -m model.source_refresh_cli --workspace /path/to/workspace list
    python -m model.source_refresh_cli --workspace /path/to/workspace show <plan-id>

Optional global --output writes JSON. The command returns 2 for a preview with unresolved problems or a returned failed execution state, and 1 for an operation exception.

## Integration

Queue planning and application with the operator's existing workspace and session controls. Preview is read-only. List/show use the same workspace controls. The panel can render changes, affected, problems, summary, state.mappings and state.run_results directly.

Required Workspace methods: _get, _list, _save, overview, get_grid, inspect_run, save_profile, save_scenario, prepare_grid, prepare_run, run, compare_runs. Native GIS remains in existing grid and execution methods.

## Delivery state

Authored against cumulative Workspace contracts read from retained source. The local execution environment was unavailable at authorship. The integrating seat coordinates one combined workflow check against actual imported source editions and the assembled application.

## Cross-edition native comparison

Source-edition changes can produce distinct grid IDs with identical real spatial support. The refresh comparison helper verifies actual native raster CRS, transforms, dimensions, units and the finite cell coverage of each edition, equal model-domain geometry, equal reporting-area geometry partitions and equal reporting-mask cells. Compatible editions produce the standard retained run-comparison raster artifacts, with source-edition context and signed alternative-minus-baseline units. Physically different spatial support is recorded explicitly as incompatible. Partial NDR or SDR runs are supported when both sides expose the same nonempty output set. The original selected models are preserved while preparing refreshed runs. Consolidated run IDs execute at most once per apply invocation.

An explicit null value in source_id_map suppresses automatic matching for that original source ID and surfaces a required mapping when a dependency uses it.

## Finite-support changes between source editions

Updated NoData coverage is usable when the spatial grid, units and study geometry remain compatible. Differences are calculated on common finite cells. Each output reports common-valid, baseline-only, alternative-only and neither-valid cell counts, actual affine/CRS-derived pixel area and corresponding areas. Baseline-only and alternative-only mass totals are retained separately in summed annual units. Excluded cells are never filled with zero. An output pair with no common finite cells has no numerical comparison. Standard raster difference units remain unchanged.

## Capture provenance and native reader layout

Repeated captures can change source_capture_id, original_archive_sha256, original_member_sha256 and source_time without changing native inputs. Those fields are lineage-only when retained bytes, companion assets and effective reader layout are unchanged. Preparation, selection, source-metadata, domain, native-grid, prepared-grid and derivation metadata remain computational unless specifically classified.

The body and each companion use the exact native reader name: retained view_path, falling back to filename. Relative-layout changes are computational because VRT references and sidecars can resolve differently even when their retained bytes are equal. Acquisition source_path changes do not change the already retained native reader view. Preview exposes native_reader_layout_changed and each edition's effective body/companion view names.
