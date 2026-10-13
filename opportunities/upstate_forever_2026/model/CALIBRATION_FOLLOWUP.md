# Continue the original annual-reference design

A working calibration can select an existing native profile, open that profile in a new Parameter study, execute meaningful parameter alternatives, and return the completed cases to Calibration. The return journey now opens with the earlier observations, source catchments, selected reference records, pollutant objective, external delivered loads, temporal weighting, spatial groups and training/validation assignments.

The scientist can edit every ordinary scientific control. The application retains the original evaluation relationship and explains how the edited design uses earlier reference records. Parameter ranking and normalization continue through the existing calibration engine and its current declared training groups.

## Use in the operator

1. Open a completed Calibration result and choose **Continue selected profile**.
2. Define the next Parameter study. Its baseline is the exact completed run selected by the earlier calibration. Save the study, execute the intended new native cases and inspect their results.
3. Choose **Calibrate completed cases** and select the actual completed native candidates.
4. Inspect the original reference design already populated in Calibration. The original uncalibrated reference, selected run and observed source remain in the linked history. The current Parameter baseline becomes the new tie-breaking reference when it is among the selected candidates.
5. Inspect catchments, review the train/validation split and save the new selection. The form preserves its populated split through the initial preview and shows how partition edits change reference reuse.
6. Analyze the selection. Read its ranking, physical errors and **Follow-up reference evaluation** section, then export or capture the editable Study.

Source identity is the exact original observation CSV body SHA256 together with its source-local record ID. Different CSVs may legitimately use the same row labels. Their labels alone do not establish reuse. The same original CSV retained with another metadata edition still identifies the same source records. Changed exports or revised underlying observations need scientific review beyond this exact-file relation.

## Interpret successive evaluations

The saved history names all linked earlier evaluations and records:

- validation records already evaluated in earlier holdouts;
- validation records used for earlier parameter selection;
- previously held-out records now entering the edited training selection;
- validation records absent from the linked original-source history.

The last category describes exact recorded history. Review spatial overlap, source dependence and period compatibility before treating new references as independent. The original model/source methods and observation support remain part of the interpretation.

Repeatedly inspecting the same reserved target does not create a fresh independent evaluation. Keep the reserved groups out of parameter selection and use new independent reference data when assessing new claims. The application keeps useful follow-up results available, identifies the relation and lets the scientist choose the design.

The live form uses the current group assignments to update reuse counts immediately. Saved plans, analysis results and exported reports use the native engine's independently derived source history.

## Native source integration

`model.calibration_followup.for_study(workspace, study)` returns the original selection template and typed prior-evaluation binding for a continued Parameter study. The existing `model.parameter_calibration.candidates` handoff supplies this as `handoff.annual_reference`.

A native caller uses the new study's actual selected run IDs and reference, preserving the original reference design:

~~~python
from copy import deepcopy
from model import calibration, parameter_calibration

packet = parameter_calibration.candidates(workspace, study_id)
handoff = packet["handoff"]
selection = deepcopy(handoff["annual_reference"]["selection"])
selection["candidate_run_ids"] = handoff["candidate_run_ids"]
selection.pop("reference_run_id", None)
if handoff.get("reference_run_id"):
    selection["reference_run_id"] = handoff["reference_run_id"]
selection["notes"] = [*selection.get("notes", []), *handoff.get("notes", [])]
preview = calibration.preview(workspace, selection)
plan = calibration.prepare(workspace, preview["selection"])
result = calibration.analyze(workspace, plan["id"])
~~~

These operations reuse original completed native runs and matching observation comparisons. New NDR/SDR execution stays with the existing Parameter/native runner. The caller can inspect and edit the selection before preparing it.

`prior_evaluation` binds the original completed calibration, plan and immutable Parameter specification. Its study selection hash includes the selected-profile origin. `reference_history` is derived from those retained native records when preparing the calibration plan and travels unchanged with the corresponding result.

## Export and reopen

Calibration result ZIPs include the complete earlier result, plan and Parameter specification under `reference-history/`. Their HTML presents the follow-up interpretation with links to the original analyses. Existing completed exports retain their own editions.

Selected Study capture follows each earlier result/plan and the direct Parameter-study root, preserving original native cases, observations, catchment bodies and their source companions. A Parameter scientific report prepared from a later selected profile also retains the complete ancestry's original observation tables and catchment editions; foreign report capture checks those exact records before incorporating the source.

The implementation is installed through the complete current Calibration/application cohort. It includes the typed direct Parameter Study continuation and receiving code; preserve the existing native operator and source versions during composition.

## Product operation

Follow `../AGENTS.md`, `../CURRENT_OWNER_DIRECTION.md` and the active post-call order bank in the original Eco thread. Open and operate the exact outgoing populated workflow, inspect its industrial desktop and narrow layouts, open the exported HTML/CSV/JSON and native Study, and fix affected problems before presenting it. Keep original completed simulations and ongoing producer processes.
