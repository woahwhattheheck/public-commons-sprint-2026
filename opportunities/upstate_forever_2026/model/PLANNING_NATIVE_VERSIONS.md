# Native versions in planning inventories

A planning inventory compares original polygon units against completed native mass rasters. The selected baseline and alternatives must use the same grid and parameter profile, share completed native outputs, and resolve to the same nonempty InVEST execution version for each native model being compared.

## Resolve the original execution version

The planning engine reuses the maintained `scenario_analysis._native_version` resolver for requested and observed values. It applies that resolver to each completed common model's original stage runtime before falling back to its containing run:

| Retained metadata for the common model | Comparison version | Recorded basis |
| --- | --- | --- |
| Nonempty `stages[model].runtime.version` | That stage's observed execution version | `observed_stage_runtime` |
| No observed stage version, nonempty `run.runtime.version` | The retained run's observed version | `observed_runtime` |
| Neither observed version, nonempty `selection.invest_version` | The original requested version | `requested_legacy` |
| No version available | The cohort cannot be built or reused | `unavailable` |

Whitespace is normalized by the original resolver. Requested, observed, comparison_version, basis and differs_from_requested remain explicit. Each per-model descriptor also carries stage_observed, including null when the historical stage lacks execution metadata. The original run-level descriptor remains alongside the model descriptors.

### Why the completed stage takes precedence

The maintained native continuation preserves an already completed stage's original runtime. If another selected model remains unfinished, executing that model updates run.runtime to describe the newly loaded runtime. A run can therefore retain original execution records that differ from its current orchestration record.

Planning binds the runtime of the stage that produced each compared pollutant. Nitrogen and phosphorus use NDR; sediment uses SDR. A stage reuse keeps its original execution metadata. The receiver does not need an old donor directory merely to read the retained version.

For example, two runs that both requested 3.20.0 but whose NDR stages executed 3.19.0 and 3.20.0 cannot form one NDR planning comparison. Two runs with the same observed NDR stage version can be compared even when their requested versions or later orchestration records differ.

The comparison is per common model. If both runs retain NDR from one version and SDR from another, the matching per-model versions remain distinct. The inventory does not turn that mixed provenance into one aggregate execution version. A comparison containing only NDR does not constrain an unselected SDR result. Original grid, profile, stage completeness, shared-pollutant and annual-mass requirements still apply.

The check runs in the shared input path before creating any inventory output directory or reading raster cells. Reopening a retained inventory and building a new one therefore use the same version policy.

## New inventory bindings

New input identities contain native_versions keyed by original run ID. Each entry contains the retained run-level descriptor and model descriptors for exactly the common native outputs.

The immutable inventory JSON and saved Workspace record also retain:

- native_versions: those exact per-run and per-model descriptors.
- native_version: the policy, ordered common model IDs, and a per-model comparison version with explicit run-runtime and requested-only fallback run IDs.

The bound provenance contributes to the input selection ID. A later change in a run or stage's recorded provenance cannot silently reuse an earlier bound inventory. Original per-feature values, common support, native raster units and summation algorithm remain unchanged.

## Reopen original inventories

Inventories saved before version binding retain their original files, saved record and IDs. On inspection, the engine verifies their original CSV and inventory, resolves the current retained native cohort, and compares every original identity field against the historical shape. It omits only the newly introduced native_versions identity field for that historical comparison.

A compatible historical inventory remains usable without rebuilding rasters or rewriting metadata. Its record remains historical; it does not acquire a claim that version provenance was frozen when first built. A historical cohort with conflicting or unavailable effective versions fails the shared compatibility check.

A new bound inventory must have complete matching version metadata in its native input identity, inventory JSON and saved record. Partial bindings or changed provenance fail inspection. Original source bodies, feature identities, grid/profile, artifacts and annual units continue through their existing checks.

## Through the current workflow

The ordinary planning inventory build/inspect paths enforce this binding. Portfolio selection and native evaluation continue through the maintained portfolio engine and its separately owned paired-baseline resolver.

Raster read reuse remains an operational setting described in [PLANNING_RASTER_CACHE.md](PLANNING_RASTER_CACHE.md). Cache budgets, timings and read counters stay outside scientific identities; native execution versions are scientific inputs and therefore belong inside the new identity.
