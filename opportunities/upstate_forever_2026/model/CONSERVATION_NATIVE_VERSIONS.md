# Conservation native execution versions

Conservation quantities use the retained InVEST 3.20.0 output-rate contract: NDR nitrogen and phosphorus are kg/ha/year, and SDR sediment is metric tonnes/ha/year. Polygon aggregation multiplies those rates by the actual intersected hectares in the original grid. Selecting a run therefore requires the version of each model that produced its outputs.

## Completed stages and resumed runs

The maintained `model/native_versions.py` helper belongs to the shared native analysis core. Conservation consumes its `native_version` and `model_versions` functions and preserves its policy string exactly:

`completed_stage_runtime_else_observed_run_else_labeled_requested_legacy`

For each selected NDR or SDR stage, the helper prefers the runtime recorded on that completed stage. It then uses the observed run runtime when the stage has no recorded execution version, followed by the explicitly labelled historical requested version. A completed stage can differ from the run's most recently observed runtime after another model resumes. The completed-stage value governs that model's quantities.

The original run selection remains unchanged. Its requested version and the last observed run version are separate fields. Partial NDR-only and SDR-only runs retain their own selected scope. Omitted `models` continues to mean the original combined scope.

The current Conservation rate adapter accepts a selected model when the shared resolver returns 3.20.0. The resolver's basis accompanies that value, including `requested_legacy` for historical records. An observed completed-stage version with a different output contract produces an explicit error naming the run, model, resolved version and evidence basis before recomputation or reuse. The error identifies the incompatible input; it does not substitute another run or reinterpret its output units.

## Additive reading contract

`conservation.inspect(workspace, study_id, include_candidates=False)` now returns `native_execution`, keyed by each original run ID. The same mapping is available through the existing lightweight Conservation catalog study endpoint. Source-context studies return an empty mapping.

Each run's value contains:

- `policy`: the exact shared resolver policy.
- `unit_contract_version`: the Conservation rate adapter version.
- `supported`: whether every selected model resolves to that adapter's version.
- `run_version`: the shared helper's separate requested and observed run-level declarations.
- `model_versions`: one full shared helper row per selected model.
- `runtime_history`: a retained copy of the original run history.

A model row contains `model`, `comparison_version`, `basis`, `observed_stage_version`, `observed_run_version`, `requested_version`, `differs_from_requested`, `stage_completed_at` and `reused_from`. The resolved `comparison_version` always appears with its basis. Only the basis `completed_stage_runtime` represents an observed execution on that particular completed stage.

New native studies bind that complete object as `study.selection.bindings.runs[run_id].execution`. Each original pollutant output also contains `execution`, referring to the matching model row. Nitrogen and phosphorus share their NDR stage provenance; sediment uses SDR provenance.

## Saved studies, plans and consumer bindings

Existing saved study and plan identities are retained. Inspecting a historical study adds a read-through provenance view without rewriting its stored selection, candidate inventory or plan files.

Before candidate calculation, completed-study reuse, portfolio calculation or decision-packet export, the backend reopens the original completed run selection and output registry. It validates the rate-unit version against the selected model provenance and checks retained output, stream and argument descriptors. For newer studies, the saved execution object must still match the original run's resolved provenance.

`conservation_bindings.bind_plan` supplies this provenance as `native_runs[run_id].execution` and each `native_runs[run_id].outputs[pollutant].execution`. Its scientific contract identifies the unit adapter version and execution policy separately from the original run selection. Implementation, design and reporting consumers can retain this complete native context with the original plan reference.

The standalone binding validator accepts complete historical bindings that predate this additive metadata under their original requested 3.20.0 contract. Newly produced bindings carry the resolver basis. Removing execution provenance from a study that already bound it is rejected. A requested-version mismatch with a supported observed completed stage is represented explicitly and is accepted by the unit adapter.

## Decision packets

A native decision packet includes `native-execution.json`, with schema `upstate.conservation-native-execution/v1`, the original study ID and the complete run mapping. Its exact bytes and SHA-256 appear in the ordinary packet manifest. The packet identity includes this resolved provenance, preserving earlier exported packets as separate retained artifacts.

Source-context packet identities and source-context calculations retain their existing behavior. The separate physical pollutant values, paired valid-cell support, original grid resolution and partial-model availability contracts remain unchanged.

## Human-readable execution sources

The existing decision report includes a **Native model execution** section. Each original run is labeled as baseline or alternative and lists its selected NDR and/or SDR models separately. The table displays the resolved model version, its provenance basis, original requested version, latest observed run version and recorded stage completion time. Completed-stage, observed-run fallback and requested legacy fallback remain distinct labels.

A companion table gives each run's quantity-adapter contract and selected-model compatibility. The expandable original JSON preserves model reuse sources and runtime history. The same typed execution map appears as `native_execution` in the existing `source-register.json`; the ordinary report dictionary defines these fields. Both new study reports and freshly exported historical native studies use the supplied maintained execution records. A source-context report with no native run has no native execution table.

Presentation reads the study's resolved `native_execution` map, or the execution metadata already bound to a newly prepared native study. It performs no additional version resolution, source acquisition or scientific run. Existing scientific quantities, candidate ordering, score methods, selected geometries and source presentation stay intact. The report implementation hash creates a new presentation edition while the original study, plan and earlier report remain retained.

## Experiment baseline compatibility

The maintained experiment engine currently uses the requested InVEST version in its generated case identity and original reference validation. Conservation's scenario bridge therefore retains that requested-version requirement when preparing an experiment. It additionally checks the effective execution version for every selected model with the same maintained resolver used by Conservation quantities.

A completed stage executed under an incompatible version is rejected even if its original request names the current version. Ready or interrupted references retain their original resume path: already completed stages are checked, while unfinished stages execute through the original engine and its requested-version selection. A supported observed execution paired with another requested version can be used by Conservation's study quantity adapter, but experiment admission also needs the experiment engine's retained case-selection contract. The bridge preserves that distinction and never rewrites the original baseline selection or run ID.

## Receiving and current source composition

Install the complete current Conservation backend and bindings with the maintained shared helper and its `model/model_selection.py` dependency. The first Conservation source edition supplied ECSA’s 3,770-byte helper (SHA-256 `bd4996f78c9e21ea8093499a7f7ff9adc9622ffce9bdb49b22f4121199a8b6f2`). The current shared successor also supplies `version_label`, `guide_url` and `run_label`; its original resolution functions and policy remain unchanged. Keep that current full source so the other scientific report consumers retain their presentation helpers. The installer recognizes the exact original helper as an upgrade predecessor.

The accompanying composition document records exact beforeimages and ordered unique replacements for the two existing consumer modules. Compose these replacements onto a newer compatible application source when other owners have changed those same modules; preserve their reporting, practice and catalog changes.

On the original equipped Workspace, reopen the existing native study and saved plan, inspect the completed selected stages against `native_execution`, export that same plan, and check the retained `native-execution.json` in its ordinary packet. The existing shared native execution owner continues to produce the scientific run.
