# Continue between original calibration and Parameter studies

Open **Parameter studies**, open a retained study, and choose **Use completed cases in calibration**. The case selector reads each actual native run. Completed cases on the original unchanged baseline are eligible; pending, failed and land-cover treatment cases retain their original IDs and show why they are excluded. Reused runs appear once with all associated study labels.

Choose the original completed runs and open the calibration selection. The calibration desk re-reads current candidate identities before accepting the handoff. It keeps the existing observation edition, source catchments, period weighting, objective settings, source filters and delivered-load entries. The study baseline becomes the exact-tie reference when included. Candidate IDs and the retained study-selection digest are recorded with the calibration draft and interpretation notes.

The new selection can use NDR, SDR or combined studies. The existing calibration engine checks the selected model scope and exposes only pollutants shared by all candidates. The operator still chooses observed annual loads and their catchments, reviews the objective and assigns calibration and validation groups through the existing calibration form.

## Original annual observations

When the scientific workspace has no admitted annual-load observation edition, the completed candidate draft still opens and remains saved in that workspace's browser session. Choose **Import original observations** in the form. After retaining the actual source records, reopen the calibration draft or open its observation binding: the original candidate IDs and study provenance remain selected.

Context measurements are retained through the ordinary observation import. The calibration objective uses its existing admitted annual-load rules. Study response ranges alone do not provide field observation records.

## Partial studies and alternative landscapes

A partial unchanged-baseline study can supply its completed cases while its other native runs remain available for continuation. Calibration selects from the explicit completed subset. Returning later to the case selector refreshes actual run states.

Land-cover treatment studies stay in the parameter-study desk for scenario sensitivity. Their cases cannot enter an annual-load baseline calibration; the selector displays the original scenario and the eligibility explanation.

## API and source interfaces

- Read `/api/parameter-studies/calibration?workspace=<registered-key>&id=<study-id>` for the live source-bound case catalogue and handoff.
- `ParameterStudyAPI.READS` adds `calibration`; it delegates to `model.parameter_calibration.candidates`.
- `model.parameter_calibration.candidates(workspace, study_id, candidate_run_ids=None)` optionally validates a distinct explicit subset against the actual eligible runs.
- `attachCalibration(...).openForCandidates({workspace_key, study_id, candidate_run_ids})` opens the existing calibration draft and retains source choices.
- The shared operator adds the existing extension-host callback to `attachParameterStudies`: `openExtension: (...args) => extensions.openExtension(...args)`.

For a retained workspace, print the same current candidate catalogue without dispatching models:

```sh
python -m model.parameter_calibration --workspace /absolute/original-study --study ORIGINAL_STUDY_ID
```

Use repeated `--candidate-run-id ORIGINAL_RUN_ID` flags for an explicit completed subset. All IDs come from the original study. The existing calibration prepare/analyze operations retain and evaluate the final annual-load selection.

## Composition

The source bank includes full postimages and exact replacements for the calibration and parameter-study interfaces. Apply the single shared-app callback replacement against the current host; retain every other host feature. The original scenario-experiment engine, native execution, observation importer and calibration model remain in place.

## Continue the selected working profile into a new study

Open a completed **Calibration** result and choose **Continue selected profile**. The existing Parameter form opens with the exact selected native run as its baseline. Its title and scientific question retain the original evaluation and its source notes. The visible **Selected profile and original evaluation** panel shows the original evaluation, profile, run, observation edition and explicit reference run. Expand **Original source notes and held-out design** to inspect the original periods, catchment selection, calibration/validation groups and selected validation result.

Choose the ordinary parameter axes, values, supporting references and reporting areas, then **Preview case design** and **Save study**. The existing queued Parameter preparation and execution actions own every new case. Opening this continuation does not create or execute a run. Original profiles, runs, scores and study editions remain unchanged.

The selected baseline is fixed while this original evaluation is attached. To design a different independent study, choose **Use a different baseline without this calibration link** and confirm. This only removes the structured link from the open new draft; the original evaluation and every saved study remain available. Revising a saved linked study re-reads the original evaluation and retains its exact binding.

A selected working profile describes the original reference evaluation. Continuing that profile does not establish field calibration or independently validate the new parameter cases. Retain the original source periods, gauge/model drainage relationship, annualization, common support, excluded rows and held-out result in the interpretation. An independently published modeled annual reference remains a modeled reference. No absent reference run is inferred.

## Transfer the saved Parameter study directly

In **Study transfer**, choose the **Parameter studies** type and select the actual saved design. **Open Parameter study** opens its original editable desk. Preview and export through the existing queued Study action; an initial scientific report source is not required. Prepared, partial and completed studies retain their actual state, every prepared native case, the immutable experiment specification, original selected-profile evaluation and complete source dependencies. Legacy Experiment programmes remain a separate study type.

After the ordinary archive receive, **Received Studies** displays the captured and current Parameter state, the retained cases, original baseline and any original calibration identity. **Open saved study**, **Open reference run** and each **Open saved run** use those exact received native IDs. A partially executed design can continue through its existing Parameter controls. Current progress may advance; the immutable design, case roster and original evaluation binding cannot change. The original capture receipt remains available.

## Reports and editable Study receiving

The saved study displays **Open original evaluation**. Preparing its scientific report source retains the complete unchanged original calibration result, plan, observation record and original CSV, together with the selected catchment source and companions. The visible report identifies the original source periods, calibration and held-out groups, working profile, selected baseline and original reference.

Parameter report source edition 4 creates a new immutable source edition. Earlier source editions remain readable. A selected editable Study follows the existing calibration lineage resolver, retaining original native run selections, observations, comparisons and source files. Imported foreign scientific sources keep their complete frozen evaluation companions and original identities; a matching-looking local identifier is not substituted.

### Source API

- GET `/api/parameter-studies/calibration-origin?workspace=<registered-key>&id=<calibration-id>` returns the exact continuation catalogue and `calibration_origin`.
- `model.parameter_calibration.continuation(workspace, calibration_id)` reads that native binding without running models.
- A new Parameter selection can include the returned `calibration_origin` object unchanged. Both preview/prepare and saved-study reopening validate it against the immutable result and plan and require the exact selected baseline.
- `attachParameterStudies(...).openFromCalibration({workspace_key, calibration_id})` opens the ordinary guarded form. The maintained host exposes `openCalibrationParameterStudy`; the Calibration descriptor declares that capability.

## Install and operate the complete source

Use the complete current application or the existing source-family exporter with the effective `calibration` and `parameter-studies` declarations. The append-only `calibration-parameter-continuation.json` fragment retains both desks, their existing report/Study readers and the current host callback. It adds no catalogue authority or dependency cycle.

For an existing complete application, run the incoming calibration installer from the received source root:

```sh
python /absolute/current-source/operator/install_calibration.py \
  --application /absolute/receiving-application \
  --source /absolute/current-source --preview
python /absolute/current-source/operator/install_calibration.py \
  --application /absolute/receiving-application \
  --source /absolute/current-source
```

The installer stages the complete Parameter continuation bodies, composes only the named callback into the current shared host, checks exact known predecessors and preserves backups and concurrency guards. Independent host/source changes require composition; they are not overwritten. Keep the existing native Workspace and completed runs. Reload the operator after an active task reaches its normal boundary.

In the original native course, open the actual completed annual-reference result and use **Continue selected profile**. Inspect the exact original run/profile/reference/holdout at desktop and narrow widths; view the resulting screenshots. Operate preview, explicit link removal/cancellation and reopening. Prepare the operator-selected axes through the ordinary queue, then retain and open the report HTML/PDF, source companions and editable Study in the receiving Workspace. Check the original calibration and baseline identities after reopening. Record actual completion separately from source review, and preserve an interrupted original task for ordinary resume.
