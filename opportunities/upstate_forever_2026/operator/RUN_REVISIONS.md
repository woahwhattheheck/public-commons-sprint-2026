# Revise a retained native run and compare the result

The **Run revisions** desk connects the existing parameter, scenario, native-run and comparison forms. It keeps one completed run as the immutable reference, saves revised inputs as new records, and retains the accepted task and result for every step.

This workflow uses the actual prepared model grid and original InVEST model selection. It does not prepare another geographic domain, change model equations, or substitute observational associations for simulated model results. The original geographic model domain, reporting area and source vintages remain those of the selected reference.

## Use the current Workspace

1. Open **Runs**, inspect the completed reference run, and choose **Revise and compare**. Alternatively, open **Run revisions** and select that completed run.
2. Enter a meaningful revision title and choose **Create retained revision**.
3. Choose **Revise parameter profile**, **Revise land-cover scenario**, or both. The original forms display the current saved selections. Save each revised record and wait for its accepted operation to finish.
4. Return to **Run revisions**. Its current profile and scenario are taken from the actual saved task results. Use **Refresh saved results** if a task has just completed.
5. Choose **Prepare revised run**. The original grid and native model cohort are fixed to the reference. The profile and scenario are the latest completed selections retained by this revision.
6. Open **Inspect inputs and start native models**. Use the existing run controls to inspect eligible and changed cells, then explicitly start or resume the original models. Preparation does not start the native calculation.
7. Once the revised run is complete, choose **Compare reference and revised run**. The original comparison form keeps the reference first and this revised run second.
8. Use **Open saved comparison and delivery** to inspect the retained comparison and continue into the existing delivery controls.

A revision cannot prepare an unchanged reference selection as a distinct run. Saving a profile or scenario creates an immutable record; the original run and its referenced inputs remain unchanged. Changing inputs after a run or comparison was prepared clears that revision's current run/comparison pointer, while its prior accepted operations and saved outputs remain in the history.

## Ordered land-cover changes

Each scenario patch has **Earlier** and **Later** controls. The visible numbered order is the exact array submitted to the native scenario compiler. Moving a patch preserves its source mask, layer, attribute filter, original land-cover codes, replacement code and reason.

The native compiler evaluates each patch against the current raster after preceding patches. A later overlapping patch therefore sees the result of earlier changes. Inspect the saved order and actual input footprint before starting the revised run. The existing compiler retains polygon pixel-centre selection, aligned binary-raster masks, NoData and final net-change accounting.

## Review actual differences

**Review actual input changes** opens the maintained Model input changes desk for the exact reference/revision pair. It uses the retained land-cover inputs, parameters, biophysical source tables and original model outputs.

**Review native quantities** opens Native process reports with the same ordered pair and native models. That desk preserves the distinction between each run's native support and paired common-cell comparisons. It exposes exact quantity, field, unit and source-row filters; its downloaded rows preserve the original unrounded CSV strings.

Parameter revisions can affect more than one model quantity. Read the original units and basis in the saved comparison rather than interpreting every difference as a land-cover effect or as a measured concentration.

## Save, transfer and reopen

**Download revision JSON** captures the complete reference binding, selected input records, accepted task requests/results and current comparison choices. Reopening this JSON checks the project, original records and selection before adopting it. It does not submit a model, invent a completed result, or replace a divergent local revision history.

The JSON is a review handoff, not a raster archive. Use **Back up complete Workspace** to retain the actual grid, source editions, scenario masks, profiles, native run outputs and revision records. After restoring that project, reopen **Run revisions** or its exported JSON. Completed scientific records remain usable even when the original operator task queue is unavailable. Open the retained run to continue native execution through the receiving operator's existing controls.

For client-facing reports and GIS outputs, use the saved comparison's existing delivery and GIS routes. Their original source, project, file and quantity identities remain authoritative.

## Acceptance and recovery

The revision form uses the original authenticated action queue. Its complete intent is retained before native task admission, and the existing operation ID prevents a lost response from starting a second task. Completed results are captured into the Workspace so its backup does not depend on an open browser.

A form opened against an older selected-input identity is rejected if another edit changes that selection. Reopen the current revision step and review the saved input labels before submitting again. Failed or interrupted native tasks retain their original request and attempts in **Tasks**.

Changing the selected Workspace or closing the desk invalidates pending display work. Source or task errors are shown explicitly; they do not convert a queue acceptance into an invitation to run the same calculation again.

## Installed source

This component is registered by integration/component_fragments/run-revisions.json. It selects the provider, browser, styles, descriptor, guide and narrow current operator hooks, together with the existing Model input changes and Native process reports components.

The new review records live under Workspace/run-revisions/. Model profiles, scenarios, runs and comparisons remain in their original Workspace locations. All calculations use the maintained original model API.

The current release is source-reviewed. Actual native execution and desktop/narrow-browser acceptance must be reported by the existing geographic model receiving operation; a source replay does not establish rendered or scientific runtime acceptance.

## Current owner direction

Follow CURRENT_OWNER_DIRECTION.md, version 2026-10-13.3. The active objective is the actual Upper Savannah geographic baseline, realistic riparian restoration and matched control, with editable assumptions and a complete reusable handoff. Keep the original 6A4E / 7b7a run lineage and existing owners. The October 13 cutoff remains 14:00 UTC; this revision course does not extend it.

Before calling the outgoing product ready, open the exact current application at the presentation width and 390 px, operate the populated revision course and applicable empty/error states, and actually view its screenshots. Open the downloaded revision JSON, complete project/archive and relevant native reports/maps in their recipient-facing applications. Confirm exact export/reopen, then repair any first returned failure. Source checks and stored screenshots that have not been viewed do not replace this use.
