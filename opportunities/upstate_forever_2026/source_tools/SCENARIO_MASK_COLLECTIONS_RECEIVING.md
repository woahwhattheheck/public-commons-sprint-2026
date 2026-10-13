# Retained mask editions in an original native scenario course

This continuation runs a supplied, complete land-cover scenario against its selected completed baseline. Each ordered mask retains its actual collection and source ID. An omitted patch-level collection keeps the scenario's original default; an explicit collection remains attached to that patch.

Use the existing native operation, installed scientific application, Workspace and equipped owner. This helper does not acquire source data, supply proposed land-cover codes, start a second queue, or create a browser. The borrowing browser chapter uses the result as its complete control document.

## Authored input

Save one JSON object with schema `upstate.scenario-mask-collections-receiving-input/v1` and these fields:

| Field | Required value |
| --- | --- |
| `operation_id` | The receiving caller's retained operation identity. |
| `project_id` | The actual selected Workspace UUID. |
| `baseline_run_id` | An existing complete native run whose saved scenario is the unchanged baseline. |
| `scenario` | The whole scientist-authored native land-cover scenario, including title, reason, default source collection and every ordered patch with its original metadata. |
| `reuse_source_run_ids` | Optional ordered unique IDs of actual completed native runs offered to the original native reuse implementation. |
| `source_revision` | Optional exact installed application source selection retained with the input. |

The schema field is also required. No other top-level fields are accepted. At least two actual retained source collections must occur among the supplied mask pairs. This condition identifies the complete multi-edition course; it is not a new restriction on ordinary native scenarios.

Grid, profile and native model selection come from the actual baseline. The helper preserves each complete patch; it does not construct a new environmental assumption from a filename or source title. A supplied scenario ID must match the original immutable writer's saved body.

Do not substitute an unrelated chemistry run or another demonstration's project. The original receiving owner selects the actual land-cover baseline and authored masks.

## Original entrypoints

Call the helper inside the existing receiving programme:

```python
from source_tools.receive_scenario_mask_collections import receive_scenario_mask_collections

control = receive_scenario_mask_collections(
    original_workspace,
    complete_authored_input,
    original_output_directory,
)
```

The same callable is exposed by an ordinary command for the owning host:

```sh
python source_tools/receive_scenario_mask_collections.py \
  --workspace ORIGINAL_WORKSPACE \
  --input COMPLETE_AUTHORED_INPUT.json \
  --output ORIGINAL_RECEIVING_OUTPUT
```

The existing owner retains its process, environment and overall operation lock. This module adds only a nonblocking lock for its selected output directory. Native Workspace, preview, execution and Study operations keep their original internal locks.

## What the native continuation does

The complete input, operation identity, actual baseline and full selected source-pair descriptions are retained before the first immutable scenario write. Every selected source body and companion is checked using its native descriptor.

The original `Workspace.save_scenario`, `prepare_run`, `scenario_footprint.preview_run`, `Workspace.run` and `compare_runs` remain authoritative. Actual reuse is decided by the existing native code. A returned summary is never substituted for model execution or its retained artifacts.

The selected Study contains both original runs and their comparison. The application’s scenario-footprint Study join also retains the exact footprint record, complete output directory, full report, original masks and companion source files. The original `study_transfer.export_study` creates the ZIP. No second archive format is introduced.

The helper opens every literal ZIP member, verifies its bytes and SHA-256, and uses the original `portable.restore` or `resume_restore` into its own receiving directory. It then compares the full scenario, both runs, footprint, comparison, complete collections and selected source entries. A separate Python process, with isolated startup and the restored application first on its import path, reopens those same objects through the copied application’s own modules.

The result contains `schema`, `operation_id`, `project_id`, `input_sha256`, `scenario`, `baseline`, `baseline_run_id`, `prepared`, `run`, `footprint`, `comparison`, `source_pairs`, the full `study` archive/manifest/receipt, restored paths, original receiving receipt and `cold_reopen`. This is the control supplied to the original borrowed-Page chapter.

## Interruption and completed reuse

The same output directory accepts only the exact retained input and operation. Immutable phase records preserve full results, not regenerated request shortcuts.

Before an incomplete operation proceeds, it compares the actual eight native implementation file hashes with its retained source selection. If source changed during an unfinished operation, preserve that operation and reopen its original installed source; do not silently continue it under a different compiler.

A completed `result.json` follows a different path: it verifies the original saved scenario, runs, footprint, sources, Study archive and independent restore. It does not call a newer compiler or execute a new native run. An absent original receiving directory is reconstructed from that same retained archive. A differing existing directory is rejected by the original restore route and byte comparison.

Each independent cold check retains its full verification script, stdout, stderr and process result in a separate attempt directory. This makes an interrupted or failed check inspectable without replacing earlier output. The complete successful cold identity remains immutable.

## Source and installed dependencies

Install this complete helper with the current original `model/workspace.py`, `model/scenario_mask_sources.py`, `model/scenario_footprint.py`, `model/scenario_footprint_study.py`, `model/native.py`, `model/study_transfer.py`, `model/portable.py` and their maintained dependencies. The public source composition and component paths must include the whole files.

The Study archive carries the application through its existing portable application selection, including the original model and source-tools directories. The cold check therefore exercises the delivered application rather than importing a replacement model.

## Human receiving

Follow the unchanged application `AGENTS.md` and `CURRENT_OWNER_DIRECTION.md`, version `2026-10-13.4`, in the same source handoff. Open and use the populated editor, each ordered mask’s edition/source controls, the completed native footprint and source details at desktop and 390-pixel width. Use the original Page and authenticated operator API.

Open the literal outgoing Study ZIP, its restored project and contained deliverables. Inspect the actual images and all report pages and editable attachments that the final selected course produces. Retain the real output files and screenshots. A source review, a parsed module or this guide does not establish that native execution or rendered inspection has happened.

The helper produces a native completion only when it actually runs successfully against the supplied retained case. The published source by itself makes no claim that an equipped owner has accepted or completed that operation.
