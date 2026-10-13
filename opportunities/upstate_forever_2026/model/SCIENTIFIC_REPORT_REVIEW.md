# Customer review of a saved scientific report

A completed scientific report can enter the existing Customer review workflow with its original HTML, PDF, data, figures, source records and rendering identity. The review uses a retained source collection, so the existing review package, responses, worklist, reconciliation and complete Workspace transfer continue to apply.

The source edition stays fixed throughout review. The operator chooses the review title, purpose, questions and notes. Creating the review does not rerender the scientific report or replace the underlying measurements.

## Operator workflow

1. In Retained source reports, choose Open saved report for an existing completed edition.
2. Choose Prepare customer review. The existing editor opens as Review saved scientific report and fixes its selected source to that exact edition.
3. Enter Review title and Purpose. Add explicit review requirements and Notes as needed.
4. Choose Retain review. The operator verifies the exact edition and complete member inventory, then queues review creation with the normalized current fields, preview operation ID and task's original creation timestamp. Editing the fields during verification asks you to submit those current fields again.
5. Choose Open retained review from the completed task. In the existing Customer review desk, use Export current review to prepare the complete reviewer package.
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
