# Continue incomplete matched-pair calculations

The programme desk can complete the baseline calculations needed to compare each saved parameter profile with its own alternative scenario. It uses the grid, profiles, scenarios and native run identities already retained in the workspace.

A programme may contain a reference profile under baseline land cover and several different profiles under an alternative. Each alternative needs a baseline under that same profile before the paired map service can isolate its scenario effect. The programme's ordinary comparison against its named reference remains available; the matched-pair continuation supplies the additional calculations for the paired analysis.

## Programme API

```python
from model.compute_programme import ComputeProgrammes

programmes = ComputeProgrammes(workspace)
preview = programmes.pair_completion_preview(parent_programme_id)
continued = programmes.create_pair_completion(
    parent_programme_id,
    expected_preview_id=preview["preview_id"],
)
result = programmes.resume(continued["programme_id"])
```

Preview is a metadata operation. It resolves the current `ensemble_candidate_issues[].required_selection` through the original programme preparation contract. Its result contains:

| Field | Meaning |
| --- | --- |
| `preview_id` | Identity of the parent, resulting selection and currently required scientific selections. |
| `selection` | Complete original programme selection plus the absent matched-pair runs. |
| `needed` | Whether an incomplete or missing matched-pair calculation currently exists. |
| `has_alternatives` | Whether the original programme contains an alternative to its baseline scenario. |
| `additions` | Newly named native selections, including their canonical native IDs. |
| `requirements` | Required selections, their originating issues and the named/native runs that will satisfy them. |
| `runs` | Full preview of the resulting programme, including existing native states. |
| `run_count`, `unique_run_count` | Named rows and distinct native calculations in the resulting selection. |
| `existing_pair_count` | Completed pollutant cohorts already available in the parent. |

Each requirement has `action="verify_or_resume"` when an original named run already selects the needed profile, scenario and native model. Otherwise it has `action="prepare"` and names the added calculation.

Creation returns the ordinary programme status with its new `programme_id`. It prepares retained native run records, then returns; execution uses the existing `resume` method and shared native work queue. There is no second native execution implementation.

The optional `expected_preview_id` protects an open form from concurrent progress. A preview already retained by a creation attempt reopens that exact continuation, even if other calculations have since finished. For a preview that has never been retained, changed requirements require a fresh preview.

When `needed` is false, open the existing paired selections. A programme containing baseline runs alone first needs a selected alternative scenario.

## What is preserved and what is added

All original named rows remain in the derived programme, including their source-stage assembly choices and experiment context. The original named comparison baseline remains the baseline. Completed native IDs stay reusable.

For each actual requirement, the coordinator searches the immutable parent run bindings for the same profile and scenario with a model scope that includes the requested native family. A selected combined NDR/SDR run can satisfy either family. It is continued under that same ID rather than receiving a duplicate single-model row.

Missing native families for the same profile and scenario are combined into one newly prepared selection. If both NDR and SDR are missing, the added calculation selects both. If the parent already selects NDR and only SDR is absent, the added calculation selects SDR. Each uses the real prepared grid and existing profile and scenario IDs.

Saved profile values, biophysical table rows, land-cover edits and hydrological input rasters retain their original identities. The original native runner verifies and continues the actual stages and output files. A retained complete run with unavailable output bytes or invalid metadata surfaces its original verification error during continuation.

## Operator integration

Use the existing authenticated programme service and task queue:

1. Resolve `pair_completion_preview(parent_id)` for the details view.
2. Display additions and requirements, using their saved profile/scenario labels and named run keys.
3. Queue `create_pair_completion(parent_id, expected_preview_id=...)`.
4. Retain the returned child `programme_id` immediately.
5. If the action includes execution, call `resume(child_id)` after creation returns.
6. Open child status and its current `ensemble_candidates`; pass the chosen candidate's `selection` directly to the installed paired-ensemble preview/build service.

Creation and resume release their own locks between operations. Do not call the queued action from inside an existing native-run lock. Pause remains the existing direct control request and takes effect at the next durable native-run/comparison boundary.

For an experiment-derived parent, the completed child follows its retained origin back to that experiment. The maintained experiment adapter verifies that every required native case and paired baseline is present and complete, then refreshes the experiment metrics with completed-only execution. Both the operator and CLI use this synchronization after normal programme locks are released.

The backend's child `pair_completion` field contains the origin record. Parent status exposes `pair_completions`, indexed by preview identity, so the desk can reopen its retained continuations after a page reload.

If an execution task fails after preparation, retain and show the child programme ID. Native execution observations, stage history and original failure details remain attached to the child's runs through the ordinary status contract.

## Command line

Use the same Python environment and existing workspace as the ordinary native programme CLI.

```sh
python -B -m model.compute_programme_cli --workspace /path/to/workspace pair-completion-preview PARENT_PROGRAMME_ID
python -B -m model.compute_programme_cli --workspace /path/to/workspace pair-completion PARENT_PROGRAMME_ID --expected-preview-id PREVIEW_ID
python -B -m model.compute_programme_cli --workspace /path/to/workspace resume CHILD_PROGRAMME_ID
```

To prepare and run in one invocation:

```sh
python -B -m model.compute_programme_cli --workspace /path/to/workspace pair-completion PARENT_PROGRAMME_ID --expected-preview-id PREVIEW_ID --run
```

The final JSON contains the child's programme ID and actual progress. Exit status is 0 for complete execution, 2 for a retained partial, paused or failed execution result, and 1 for a raised preparation/execution error. A raised error after child preparation identifies that child for recovery.

To export a completed cohort for the paired service:

```sh
python -B -m model.compute_programme_cli --workspace /path/to/workspace ensemble-candidates CHILD_PROGRAMME_ID
python -B -m model.compute_programme_cli --workspace /path/to/workspace ensemble-selection CHILD_PROGRAMME_ID CANDIDATE_ID
```

## Retained origin and interpretation

Before preparing a child, the parent retains the complete selection, additions and requirements in `compute-programmes/<parent-id>/pair-completions/<requirements-digest>.json`. Each child also retains `compute-programmes/<child-id>/pair-completion.json`, containing its parent ID, preview identity, exact added native selections, required selections and their named/native run mappings. If a process stops between preparation and writing the child origin, status and experiment synchronization recover that origin from the already saved parent request. Repeating creation with the same preview resumes the saved request or reopens its existing child. The next creation continuation persists the child origin and parent backlink. It is included in the existing workspace backup alongside the parent, child and original native outputs. The source reference identifies the parent plus the exact retained requirements; the programme identity also captures the installed source files.

The paired service compares a baseline and alternative under the same profile and grid. Each selected profile appears once in its pollutant cohort. NDR and SDR cohorts combine only when their exact native pair lists match.

Programme difference columns use alternative minus baseline. Paired effect maps use baseline minus alternative, so positive paired effects mean less exported annual mass. Member quantiles summarize the explicitly selected profile responses.
