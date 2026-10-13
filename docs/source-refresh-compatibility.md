# Source refresh: retained plan compatibility

Both saved plan formats remain usable in the cumulative application. Existing immutable plan IDs and original native selections remain intact.

## Saved formats and APIs

| Engine marker | Retained body | Execution state | Native entrypoint |
| --- | --- | --- | --- |
| `edition` | `selection` and `preview.schema = upstate.source-refresh-preview/v1` | `source-refresh/<plan>/state.json` | Edition dependency remapping and full-domain recomputation |
| `roots` | Version 1, workspace ID, mapping, selected roots and dependency nodes | `source-refreshes/<plan>/state.sqlite3` | Original root-selective SourceRefresh implementation |

`model/source_refresh_legacy.py` retains the original implementation unchanged. `model/source_refresh_compat.py` installs the shared function API and the original SourceRefresh class surface after the edition engine has loaded.

The shared functions are preview, save_plan, get_plan, list_plans, apply_plan, report_plan, validate_plan and export_lock. New preview/save_plan calls retain edition plans. get_plan/list_plans/apply_plan identify the selected immutable body and use its corresponding engine. An unrecognized body remains visible with its ID and format error.

get_plan returns a common read view with top-level ID, title, selection, preview, engine, format and state. Root-selective views also retain immutable_plan with the original body. Common state exposes state/status, phase, mappings, run IDs and errors. An unstarted legacy plan has no persisted timestamps, so the shared view uses null timestamps rather than changing the idle page on every read. Lists retain descending updated_at/ID ordering.

SourceRefresh.source_diff and SourceRefresh.plan retain the original argument forms. In particular roots=None preserves original automatic root selection, while roots={} preserves an explicitly empty selection. SourceRefresh.get returns the exact saved body used for original export validation. SourceRefresh.list retains the original nested plan/state list shape and includes both formats.

The retained legacy browser catalog lists roots-format plans only, matching its original dependency-node renderer. Its existing root-plan operations stay unchanged. Use the shared Source Updates view to browse and operate on both formats. The class and CLI list APIs continue to include both formats; immutable plan bodies and IDs are preserved.

## Apply, resume, reports and backup

The original root-selective apply implementation keeps its progress, cancellation and SQLite step state. The edition engine retains its original per-object checkpoints. The class facade forwards progress events and observes cancellation after an edition checkpoint; an active native model finishes its current call before cancellation is recorded. Native operations continue through the original Workspace runner, so existing model-stage reuse remains available.

The function apply_plan defaults to preparation. The original root-selective class and CLI keep their execute-runs default. Use --prepare-only for the original CLI and --run-models to request edition model execution.

report_plan returns json, csv and html. Root-selective plans use their original report implementation. Edition reports include immutable input selections, affected-object remappings, retained native comparison descriptors and common-support coverage. Annual export differences remain alternative minus baseline; summed mass units remove the per-pixel denominator once. The original workspace backup path exports either format under its corresponding refresh lock.

## CLI compatibility

The original CLI is retained at model.source_refresh_legacy_cli. The shared CLI also forwards the original diff/status/report/export commands and --from, --to, --mapping, --roots, --prepare-only and --progress forms. --legacy explicitly selects the original parser and nested list output. Existing root-selective apply commands preserve their native execution default.

Both before-command and after-command --workspace forms work. Examples:

```bash
python -m model.source_refresh_cli preview --workspace STUDY --selection edition-selection.json
python -m model.source_refresh_cli --workspace STUDY plan --from-collection OLD --to-collection NEW
python -m model.source_refresh_cli plan --workspace STUDY --from OLD --to NEW --roots selected-roots.json
python -m model.source_refresh_cli apply --workspace STUDY PLAN --prepare-only
python -m model.source_refresh_cli apply --workspace STUDY EDITION_PLAN --run-models
python -m model.source_refresh_cli report --workspace STUDY PLAN --format html --output refresh-report.html
python -m model.source_refresh_cli --legacy list --workspace STUDY
```

The source difference read view preserves the original legacy change/reason and shows the edition engine's byte, metadata and native-reader-layout classification separately. Execution always follows the saved plan's own engine and selected roots.
