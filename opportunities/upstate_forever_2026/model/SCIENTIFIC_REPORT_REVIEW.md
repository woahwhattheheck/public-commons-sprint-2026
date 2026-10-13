# Customer review of a saved scientific report

A completed scientific report can enter the existing Customer review workflow with its original HTML, PDF, data, figures, source records and rendering identity. The review uses a retained source collection, so the existing review package, responses, worklist, reconciliation and complete Workspace transfer continue to apply.

The source edition stays fixed throughout review. The operator chooses the review title, purpose, questions and notes. Creating the review does not rerender the scientific report or replace the underlying measurements.

## Operator workflow

1. In Retained source reports, choose Open saved report for an existing completed edition.
2. Choose Prepare customer review. The existing editor opens as Review saved scientific report and fixes its selected source to that exact edition.
3. Enter Review title and Purpose. Add explicit review requirements and Notes as needed.
4. Choose Retain review. The operator verifies the exact edition and complete member inventory, then queues review creation with the normalized current fields, preview operation ID and task's original creation timestamp. Editing the fields during verification asks you to submit those current fields again.
5. Choose Open retained review from the completed task. In Files, the original scientific report appears above its full file inventory. Choose Read original PDF to read the complete compiled report, or Download original PDF to retain that file. Export complete review (also available as Export current review) prepares the full reviewer package with the linked HTML, figures, data and exact response history.
6. Use Receive response for the actual returned feedback. Current requests keeps questions, requested changes and the existing engineering response/reconciliation workflow available.

A source change or an edited review draft requires a fresh preview. An interrupted queued request uses its original task identity and creation time; it reuses the same retained source and review edition.

## Original report and source contract

The shared model/scientific_report_editions.py verifier reads:

- scientific-report-editions/EDITION_ID/edition.json
- scientific-report-editions/EDITION_ID/operation.json
- scientific-report-editions/EDITION_ID/selection.json
- every original descriptor in the saved report's files inventory.

The edition ID must match the digest of its original render identity. The completed operation, saved selection, full file inventory and current bound original study sources must agree. Every selected file is checked against its retained byte count and SHA256.

The adapter retains one source entry:

| Property | Value |
| --- | --- |
| Native manifest schema | upstate.sources/v1 |
| Entry kind | document |
| Role | SCIENTIFIC_REPORT_REVIEW |
| Primary body | The actual original report_html member |
| Companions | All remaining original report members, plus edition.json and operation.json |
| Source URI | urn:upstate:scientific-report:PROJECT_ID:EDITION_ID |
| Metadata | Complete original edition identity, render identity, ordered observed-source binding and report counts |

The copied report tree is unchanged. Its HTML can still resolve its original figures and linked data within the source view and exported review package. The compiled source has schema upstate.scientific-report-edition/v1 in its metadata; it is not registered as another observed-report recipe.

The underlying original observed studies keep their separate source collection/document identities. The compiled report source records those exact ordered bindings.

The Customer review report card identifies the compiled PDF through the declared original `report.pdf` member, its source part, artifact identity and authenticated download ticket. PDFs embedded in the original studies remain in the complete file inventory and are not substituted for the compiled report. The card shows the retained report title and available study/figure counts; its saved-edition identity and PDF checksum remain available in details.

## Backend API

The additive adapter is model/scientific_report_review.py. Both functions accept an existing Workspace object or its original path.

~~~python
preview = preview_review(workspace, edition_id, review_selection)

result = create_review(
    workspace,
    edition_id,
    review_selection,
    expected_operation_id=preview["operation_id"],
    created_at=original_task_created_at,
)
~~~

The review_selection argument contains only:

~~~json
{
  "title": "Review of the selected scientific report",
  "purpose": "Review the original methods, findings and source support for the stated project purpose.",
  "requirements": [
    {
      "id": "methods",
      "title": "Methods and interpretation",
      "detail": "Identify any requested clarification to the methods or interpretation."
    }
  ],
  "notes": []
}
~~~

These are editable review questions. They do not constitute a response or approval.

preview_review returns the normalized review_selection, operation_id, actual scientific_report_edition_id, original report title, source_identity, original_study_count, section_count, figure_count, sources, primary_path, member_count, total bytes and complete member descriptors.

create_review verifies the preview again, imports or reopens the original compiled-report source, then calls the existing reviews.create_review with the real source_collection_id and original task timestamp. It reopens the result through reviews.show_review to check every artifact.

Its result contains:

- review_id and scientific_report_edition_id.
- operation_id, actual created_at, title and purpose.
- Actual source_collection_id and source_id.
- The full source_identity and actual native review_selection.
- artifact_count, source_member_count and original_study_count.
- source_directory and a source_receipt descriptor relative to the original Workspace.

The existing native review selection remains upstate.customer-review-selection/v1. Its source_collection_ids list contains the actual imported compiled-report collection. No new review-selection kind is introduced.

## Original source retention and retries

Source copies live under:

~~~text
scientific-report-reviews/SOURCE_IDENTITY_DIGEST/source/
    report/
        report.html
        report.pdf
        original report data, figures and source-member trees
        edition.json
        operation.json
        selection.json
    model-sources.json
    source-receipt.json
~~~

The source identity binds the original project, edition, complete render identity, primary HTML path and every member's original bytes/hash. Source creation has its own lock. An existing source receipt is reused only after verifying the original copied files, imported source collection, complete relative tree and body identity.

Reviews retain the source through the ordinary native source collection. Offline export therefore includes the exact HTML and all companion files beside it. Existing review receiving and Workspace backup/restore preserve the ordinary source objects and review records.

## CLI

Use the current complete application and an existing saved scientific edition. The review selection JSON is the explicit document shown above.

~~~sh
python -B -m model.scientific_report_review \
  --workspace /path/to/original-workspace \
  --edition-id ORIGINAL_SAVED_EDITION_ID \
  --review-selection review-selection.json \
  --preview
~~~

Then use the actual returned preview operation ID and one retained creation timestamp:

~~~sh
python -B -m model.scientific_report_review \
  --workspace /path/to/original-workspace \
  --edition-id ORIGINAL_SAVED_EDITION_ID \
  --review-selection review-selection.json \
  --expected-operation-id RETURNED_PREVIEW_OPERATION_ID \
  --created-at ORIGINAL_REVIEW_CREATION_TIMESTAMP
~~~

For a retry, keep the same timestamp and original review selection. A new intended review round can use a new retained creation time while reusing the same original compiled-report source.

The resulting review_id is the existing Customer review ID. Its ordinary show, export, receive-response and worklist operations apply without another report engine.

## Related maintained code

- model/scientific_report_editions.py — shared original saved-edition inspection.
- operator/source_report_editions.py — queued scientific rendering and saved-edition interface.
- model/reviews.py — review selection, artifacts, export, responses and receiving.
- model/review_worklist.py — current returned requests and engineering responses.
- model/portable.py — complete original Workspace backup and receiving.


## Transfer the editable review with its scientific report

In **Customer reviews**, open the saved review and choose **Transfer editable
review**. The existing Study transfer desk receives that exact saved review.
Preview its original dependencies, then use the original queued Study export.
Restore the resulting archive into a new directory through the ordinary
Workspace restore flow and open **Customer reviews** in the received project.

The selected transfer retains the original review title, purpose, requirements,
notes and complete selected artifacts. It also retains the complete native
customer response chain, item decisions, questions, requested changes, correction
assignments and resolutions. Engineering handbacks carry their original response,
previous handback and explicitly selected revised review; their selected original
and revised scientific records travel together. These remain the maintained
review records, not a copied parallel store.

A selected saved scientific report also includes its linked Customer reviews
when **Include related results** is enabled. This association requires the
original `SCIENTIFIC_REPORT_REVIEW` source identity, project and saved edition.
Imported reports from another project retain their captured source files without
resolving the other project's producer IDs locally. Turning related results off
leaves the report selection narrower; explicitly selecting a Customer review
always includes the dependencies required to reopen that review.

Received review-package receipts carry the unchanged original ZIP in the
Workspace's content-addressed objects. Returned response documents retain their
complete original JSON bytes, including staged returns awaiting reconciliation.
Prepared and completed reconciliation records keep the actual choices, candidate,
predecessor, operation identity and resulting response. An interrupted prepared
reconciliation remains prepared; transfer never silently imports or resolves it.

After receiving, append responses, reconcile an independently returned response,
or prepare a further engineering handback through the same original controls.
Receiving verification requires the transferred response prefix and every
captured immutable member. New replies and later completed reconciliations may
extend that history without invalidating the original transfer.

The native report HTML/PDF, linked figures/data and original report source
receipt retain their paths and hashes. The original source files behind mixed
review selections, completed runs, map exports and deliveries are included by
the existing typed scientific dependency closure. Historical local browser-view
caches and sender-local operator export directories are recreated through their
original controls on the receiving computer; they are not substituted for the
retained original review archive, source records or feedback.

Implementation: `model/customer_review_study_transfer.py` composes the original
`model.reviews`, `review_handback`, `review_receiving` and
`review_reconciliation` validators. Source resolution reads existing CAS members
without creating source-view links. The original Workspace and reconciliation
locks protect capture. No native model or report rendering is run during transfer.
