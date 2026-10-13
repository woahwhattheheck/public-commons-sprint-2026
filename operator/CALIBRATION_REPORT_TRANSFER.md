# Calibration history in selected scientific report editions

TokenJunkieLabs — original Upper Savannah operator.

A saved scientific report edition retains its ordered original source choices.
When a chosen document was produced by the maintained native calibration-review
producer, the editable study also carries the review's original scientific work.

For a report from this project, that includes the completed calibration review,
its design and every frozen candidate native run, the observation edition and
catchment source, the result's observation comparisons, its originally selected
run/profile, and any explicitly selected source-error supplement or residual map
edition. The original review dossier and report-source export stay complete:
HTML, tables, maps, records, figures, source companions and ZIP files retain their
published paths and bytes. Reopening the received study uses those same saved
records. No calibration, model or uncertainty calculation runs during capture.

## Operator journey

1. Prepare a calibration review using the saved nominal result. Choose the
   original uncertainty/map supplements to include, then prepare its scientific
   report source.
2. In Sources, add that source to the ordered scientific report composer.
   Keep the other source sections in the desired order and render the report.
3. Use the saved report edition's editable Study transfer action. The preview
   includes the explicit original calibration dependency records and native
   studies. Export through the original queued study operation.
4. Restore the archive into a new directory through the original workspace
   receiver. Open the saved scientific report edition, then its native review
   and original calibration results. Additional work can be saved normally.

A source produced in another project retains its self-contained original dossier.
Its donor project identity stays explicit; it does not attach matching-looking
record IDs from the receiving project.

## Maintained source contract

`model/study_report_transfer.include_calibration(closure, collection_id, entry)`
is called only for ordered sources of the new saved scientific-report edition
root. Generic source traversal remains unchanged, so existing selected-study
archives retain their earlier report-lineage semantics.

The recognized producer is `native-calibration-review-report-v1` with original
`upstate.observed-report/v1` recipe and explicit
`native_calibration_review` binding. Source metadata, recipe inputs, original
dossier manifest and complete source stamp must agree. Each local dependency
uses the original content-addressed record, never an inferred path or title.

`model/calibration_study_transfer` provides `IMMUTABLE_KINDS`, `LABELS`,
`visit(closure, kind, key, value, reason)` and `lock_paths(closure)`. It owns the
six existing calibration record families. The core uses the native export
locks before staging. The helper reads source objects directly and does not
materialize new CAS views while the original selected-study inventory is held.

The existing report-lineage receipt includes the explicit review, selection,
source stamp, nominal run/profile and local required record identities.
Receiving reconstructs the same selected source dependencies. Recovery pointers
are validated when present; an immutable completed export is not rejected merely
because its final recovery pointer was interrupted. The existing original analysis continuation is retained alongside the immutable
completed result named by a review; its plan-to-result link and comparison
checkpoints remain available after receiving.
