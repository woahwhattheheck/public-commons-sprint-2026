# Use completed parameter studies in calibration

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
