# Use a saved Observation edition in Reach Chemistry

The existing Measured observations desk now offers a saved Observation edition as the source for its original Reach Chemistry binding. The scientist still chooses the physical case, exact measurement operator, station-to-reach assignment, time, uncertainty, and fit/holdout roles. The original Chemistry engine performs the selected analysis.

## Operator course

1. In **Measured observations → Observation editions**, select the complete original sources, review cross-source relationships and any explicit exclusions, and save a named edition. Same-observation groups require an explicitly selected original representative. Independent replicates remain separate; nothing is averaged.
2. Expand **Bind reviewed measurements to Reach chemistry**. Choose the existing physical model and the named edition in **Observation source**. Clear optional station/date/parameter filters: the saved edition already fixes its population and source scope.
3. Choose **Inspect original records**. Review the edition ID, saved counts and all original records. The adapter keeps excluded, unresolved and duplicate representations in the population with their original reasons. It intersects the saved edition's eligibility with current Measurements reviews and source-version decisions. An edition cannot make a currently excluded or superseded value admissible. Conversely, later acceptance does not remove an exclusion frozen in that edition: create a revised Observation edition to adopt the changed review decisions.
4. Complete the original scientific controls: station/reach and source rationale; characteristic, method, fraction, conserved basis, modeled components and error scale; actual model time or an explicit reviewed day; fit/holdout roles and the original analysis request. Censored values retain the native finite-bound requirements. A discrete concentration is never converted into an annual mass.
5. Save the reviewed binding. Its child case retains the entire immutable edition, exact original edition export text, all original source files and the complete editable Measurements workspace. The original source records, saved edition and physical parent case are unchanged.
6. Reopen the saved binding, inspect accepted and excluded records, then deliberately choose **Run retained native request**. The original queue and saved operation journal own execution and recovery. A changed source selection or scientific request creates a distinct binding; a lost reply does not authorize a replacement operation.
7. In the opened Reach Chemistry case, inspect the completed run, prepare its existing Chemistry report and report source, and open that source in **Scientific report**. The original report composer produces readable HTML/PDF and complete source/data companions. Retain the original run and source IDs with the report.
8. Export the complete editable Chemistry case with the completed run. Receive that ZIP into an independent Workspace, inspect the received case's sources, and use **Read selected case sources → Inspect original binding and review → Adopt this original binding in the received workspace**. The original binding and edition remain available with their received source references. The complete Measurements companion can also be received into an empty Measurements store, preserving the saved edition and every original source/review.

The full original native report and case receiving methods are maintained by `model.chemistry`, `model.chemistry_reports`, `model.chemistry_report_source` and `model.scientific_report_editions`. This join supplies source selection; it adds no solver or alternative report engine.

## Scientific boundaries

A saved representative is a source choice, not an assertion that differing measurements are scientifically equivalent. Its original relationship rationale, evidence reference, acknowledged support differences and complete alternatives travel with the binding. Excluded or unresolved records remain explicit native exclusions.

Current native eligibility is evaluated independently. The original Chemistry producer may resolve only the conditions it already explicitly supports, such as a reviewed chemical-reach assignment or scientifically supported finite censoring interval. Quality-control, source-review, method/basis, support and source-revision restrictions remain. The original optional TKN-plus-NOx derivation still requires its exact source methods and matching activity; no new chemical derivation is introduced.

The `upper-savannah-calibration-input` export contains discrete original measurements. It is not an annual NDR/SDR calibration input. Annual stream-load comparison still requires the existing supported discharge/load derivation, catchment, period and mass-rate admission.

The native source snapshot contains all original source occurrences. A canonical record appears once in the fitting population, while all its agreeing source occurrences remain in provenance. Same-observation suppression applies only to the explicitly unselected original record IDs. Independent replicates remain distinct records.

## Exact API and command

The existing `POST /api/measurements/chemistry` catalogue includes `observation_editions`. Inspect accepts optional `observation_edition={id,digest}`, with empty `filters`. The returned edition selection is retained unchanged in the original preparation selection.

```sh
python -B -m measurement_workspace.chemistry \
  --workspace ACTUAL_WORKSPACE --output OWNED_OUTPUT/edition-inspection.json \
  inspect --case-id ACTUAL_CASE --observation-edition EXACT_EDITION_SELECTION.json

python -B -m measurement_workspace.chemistry \
  --workspace ACTUAL_WORKSPACE --output OWNED_OUTPUT/edition-binding.json \
  prepare --selection COMPLETE_REVIEWED_BINDING_SELECTION.json
```

The edition selection file contains only the actual saved `id` and `digest`; the complete binding selection includes those fields under `observation_edition`, the inspected current `expected_revision`, empty `filters`, and every original scientific choice described in [MEASURED_CHEMISTRY.md](../MEASURED_CHEMISTRY.md). Do not substitute example IDs or inferred scientific settings.

The existing whole native receiving course [MEASURED_CHEMISTRY_RECEIVING.md](../source/MEASURED_CHEMISTRY_RECEIVING.md) supplies the original constructed 36-record reference, native run/report/export and independent receive path. Add `--save-observation-edition` to operate the entire original course with an immutable saved edition and verify it after cold receiving. Actual field data retain their own source, case and receiving identities; the reference is not a claim of field calibration.

## Current installation and receiving

The additive `measurement-observation-chemistry` component selects both original Chemistry and Observation editions. It does not create a dependency cycle. Existing Chemistry without the optional Observation edition route still lists its original records and bindings; the edition choices remain empty.

Adopt complete current source at the existing accepted receiving boundary, preserving active processes and later shared postimages. The original 7915/8007 Measurements receiver and retained-source recovery remain the same operation. No second runtime, source acquisition or scientific controller is needed.

Before presenting this product as ready, the producing peer must open and operate the exact outgoing application at desktop/screenshare and 390px, view the actual rendered result, exercise source switching, unfinished definitions, stale revisions, save/run/recovery, reports and cold receiving, and repair material defects. Literally open every outgoing HTML/PDF page, source/data download and extracted editable archive. Source review and explicit source adapters do not establish native SQLite/Python, browser or numerical completion. Preserve current owner controls, original source history and TokenJunkieLabs attribution. No client send is implied.
