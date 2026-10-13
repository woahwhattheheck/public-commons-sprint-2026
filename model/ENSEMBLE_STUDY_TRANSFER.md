# Transfer a saved native study through its scientific report

A saved native scenario and parameter study can be delivered as an editable
scientific study from its saved Scientific reports edition. The selected report
keeps its original source order, title, figures and numerical quantities. Its
original design, inputs, native runs and paired comparisons travel through the
maintained Study transfer and portable Workspace receiver.

## Operator course

Open **Scenario sensitivity**, choose the saved design, and prepare its scientific
study source. Open the shared Scientific reports composer, preview the retained
source, and save the report edition. In Study transfer, select that **Saved
scientific reports** edition and preview the dependency list. Export the selected
study, receive its original archive, and reopen both the report edition and its
Scenario sensitivity design in the received project.

The native report producer and scientific interpretation are documented in
[NATIVE_STUDY_SCIENTIFIC_REPORT.md](NATIVE_STUDY_SCIENTIFIC_REPORT.md).
The original paired report remains available beside the typed scientific source.

## Retained editable records

The selected source carries the exact original numerical release, saved design,
run states, comparison records, prepared-grid metadata, original profiles and
mapped scenarios. Its input inventory identifies every original raster,
coefficient table and scenario-mask source. The report retains source bodies
and companions declared by the producer; the selected editable-study archive
also includes the native input and output trees through the maintained
dependency resolver.

For a source produced in the receiving project's original Workspace, the
resolver retains:

- The immutable `ensembles/<id>.json` design and its original progress,
  common-support pair caches, current numeric summary and report pointers.
- Every selected native run, prepared grid, profile, parent profile, scenario
  and original source collection with its complete bodies and companions.
- The exact numerical report release and original paired comparisons used by
  the selected scientific source.
- The source operation, registered typed source, figure specifications,
  coordinate CSV, rendering outputs and complete original source package.
- Any newer report or scientific-source operation reached by the design's
  current pointers, so the editable design can reopen after additional work.

The saved report continues to describe its captured original result. A later
native stage can complete without rewriting that report. Its original paired
artifact descriptors must still match the outputs used by the selected
report. The native comparison resolver keeps the actual model and version
checks for those comparisons.

Imported report sources from another original project retain their exact
contained records and source provenance. Their IDs remain associated with that
original project rather than being mapped to unrelated local model records.

## Existing Python entrypoints

Use the actual saved report-edition ID from the original Workspace:

```python
from model.workspace import Workspace
from model.study_transfer import preview, export_study

workspace = Workspace("/actual/original/workspace")
selection = {
    "title": "Retained native scenario and parameter study",
    "roots": [{"kind": "scientific-report-editions",
               "id": original_saved_report_edition_id}],
    "include_related_results": True,
}
dependency_plan = preview(workspace, selection)
result = export_study(workspace, "/actual/output/native-study.zip", selection)
```

Receive that ZIP through the maintained Workspace archive receiver. Start the
operator from the application inside the received archive and open its original
Workspace. The normal selected-study receiving verification checks the saved
report, its ordered source bindings and original editable dependencies. Use the
ordinary saved-design continuation to complete any pending native members.

## Source and capture behavior

`ensemble_study_transfer.include_source` is called from the existing
scientific-report edition resolver after the ordered source is validated. It
reads original content-addressed bodies and recorded Workspace members. It
does not materialize source views during closure capture.

The producer's basis names the original Workspace, design, numerical report,
run and summary signatures, and exact producer/figure-helper identities.
Its digest is the source operation ID. The selected transfer records this
binding in the existing scientific-report source lineage receipt.

The capture acquires the original native-design execution, report and state
locks and scientific-source preparation locks. Existing native run/grid/
comparison locks and portable archive publication remain part of the same
Study transfer. The original source paths and saved operations are retained
through export and independent reopen.
