# Receive a saved scientific report through Customer review

This maintained command takes an existing completed scientific report through the normal Customer review workflow: retain an explicit review request, export its complete offline review package, back up the full original Workspace, restore a separate copy, and receive the same package against the restored source files.

The result is a working reviewer package and a separate restored scientific project. The HTML, PDF, figures, data, original source records, ordered study binding and review requirements keep their native identities. Actual returned feedback continues through the existing Receive response and Current requests controls.

## Run the current complete application

The entrypoint is source_tools/receive_scientific_report_review.py. It uses the existing saved scientific-report verifier, scientific-report review adapter, reviews engine and portable Workspace receiver. Install the current complete application before starting. The command requires an actual saved scientific edition; it does not select a model cohort or generate an outcome.

List verified saved editions in the existing Workspace:

~~~sh
python -B source_tools/receive_scientific_report_review.py \
  --workspace /path/to/original-workspace \
  --list
~~~

Choose the exact returned edition ID. Each row identifies the report title, original study count, sections, figures and retained member count. In the operator, the same reports appear in Retained source reports under Saved scientific reports.

Save the intended review request as JSON. Its title, purpose, requirements and notes are the actual questions for the selected work. This is the same document accepted by the existing Review saved scientific report editor:

~~~json
{
  "title": "Scientific report review",
  "purpose": "Review the methods, interpretation and source support for the selected project discussion.",
  "requirements": [
    {
      "id": "interpretation",
      "title": "Scientific interpretation",
      "detail": "Identify any corrections or clarifications needed to the report's findings and their stated support."
    },
    {
      "id": "implementation",
      "title": "Implementation decisions",
      "detail": "Identify which proposed next steps are suitable for the stated project purpose and which need revision."
    }
  ],
  "notes": []
}
~~~

Set those questions to the actual review purpose, then run:

~~~sh
python -B source_tools/receive_scientific_report_review.py \
  --workspace /path/to/original-workspace \
  --edition-id ACTUAL_SAVED_EDITION_ID \
  --review-selection /path/to/review-selection.json \
  --output /path/outside-workspace-and-application/scientific-review-receiving
~~~

Standard output contains the complete final result JSON. Standard error reports the actual phase as it starts, including review preparation, package export, complete backup, restore and receiving.

The output root must be outside both the original Workspace and application. The command creates one digest-named operation directory, then writes the review package, its ZIP and the complete Workspace archive there. Restoring always uses the operation's separate restored directory.

## Select and preserve the review generation

On the first call, the receiver saves one review creation timestamp before calling the existing adapter. Retries use that same timestamp, normalized review request and original edition, so they reopen the same review ID.

The request is retained both inside the Workspace and in the external operation directory. The Workspace copy is authoritative when external output has been lost or when the original Workspace has been restored elsewhere. If both copies exist, they must agree. A lock inside the retained Workspace operation also serializes the same request when different output directories are selected.

To reproduce a review already prepared with a known original timestamp, supply that timestamp explicitly:

~~~sh
python -B source_tools/receive_scientific_report_review.py \
  --workspace /path/to/original-workspace \
  --edition-id ACTUAL_SAVED_EDITION_ID \
  --review-selection /path/to/the-same-review-selection.json \
  --created-at ORIGINAL_REVIEW_CREATION_TIMESTAMP \
  --output /path/to/receiving-output
~~~

The explicit timestamp and request must match the intended original review. Omitting it starts or resumes the receiver's own persisted request for this source identity.

Before exporting, the receiver captures the actual response prefix once: either no recorded response or the exact latest retained response and all its predecessors. It always passes that explicit generation to reviews.export_review. Later genuine feedback can remain in the Workspace without changing the selected offline package generation.

Opening or exporting a review does not create a reviewer response. The existing offline review desk provides the normal response form, and actual feedback returns through the maintained review importer.

## Complete original package recovery

The exported package contains its normal native files:

- index.html, the offline Customer review desk.
- review.json, the original request and selected actual response history.
- response-template.json, the original editable template.
- README.md and review-manifest.json.
- Every selected artifact under its original files/ path, including the report's complete companion tree.

The receiver retains the exact original non-artifact package members inside the Workspace. This matters because the native exporter timestamps the package manifest and response template. Re-exporting those controls would produce a different package generation.

When an external package is missing, the receiver reconstructs its artifact paths from reviews.review_file and copies the exact retained package controls. The normal inspect_packet API then verifies the complete original member inventory and package identity. It retains the lightweight controls once; the source artifacts already belong to the Workspace.

The package ZIP's byte identity is recorded in its external export receipt. A newly reconstructed ZIP can have different archive timestamps while preserving the exact original package files and logical package identity. Source and review identities remain unchanged.

## Interruption and restore behavior

Each completed phase is reopened and checked before reuse:

| Phase | Retained identity |
| --- | --- |
| Original review request | Edition, normalized questions, saved creation timestamp and preview operation |
| Report source | Actual source collection, primary HTML, full companion tree and every original file hash |
| Selected feedback | Exact existing response prefix, including an explicit empty prefix |
| Offline package | Native manifest, complete original control files and selected artifact hashes |
| Workspace backup | Original project, complete retained receiving records and archive bytes/hash |
| Restored project | Original project, saved scientific edition, ordered source binding and complete review source |
| Received review | Same request, selected package generation and original artifact identities |

The command adopts an already completed ZIP or restore if a process ended after its atomic publication but before its receipt was written. Adoption requires validation of the original content.

For the exact fixed staging ZIP paths used by this operation, a complete valid staging ZIP is validated and published. An incomplete staging body is removed only while the receiver holds both its retained-operation lock and external-output lock; the normal engine then rebuilds that stage. Unrelated output paths and complete mismatched packages are preserved and rejected.

The full backup includes native intermediates and deliveries. It also contains the saved scientific edition, original study/source objects, compiled-report review source, review records and retained package controls. The restored Workspace is opened through the current native Workspace and portable APIs, then reviews.receive_packet joins the original package against those restored originals.

## Result and subsequent use

The final result identifies:

- The actual project, scientific report edition, review and source collection IDs.
- Original review creation time, title and purpose.
- Original study, report-member and review-artifact counts.
- The selected actual response generation.
- The complete reviewer package and ZIP.
- The full Workspace archive and restored Workspace/application.
- The received offline review directory.
- The reopened original source identities, complete artifact descriptors and selected response prefix.
- The retained receiving directory and external result.json.

Open the exported or received index.html to review the selected report and its files. Use the restored application with its restored Workspace to continue the same Customer review, source reports and worklist. An actual returned response can be imported through Receive response; existing review reconciliation and engineering response history remain available.

This command belongs to the existing review/source-report workflow. Its saved source edition is the same one opened through Prepare customer review, Retain review and Open retained review in the operator.

## Maintained dependencies

- model/scientific_report_editions.py: verifies the existing saved edition and original source binding.
- model/scientific_report_review.py: retains the original report as a native source and creates the ordinary review.
- model/reviews.py: original request, artifacts, package inspection, export, receiving and responses.
- model/portable.py: complete Workspace backup and separate restore.
- model/SCIENTIFIC_REPORT_REVIEW.md: operator workflow and adapter contract.


## Transfer only the selected review and continue real feedback

The existing whole-Workspace receiving course can now finish with the original
Study transfer archive. Add `--selected-study` to its ordinary command. It
selects the actual saved review as `{kind: "reviews", id: REVIEW_ID}`, follows
its required saved report and native sources, captures the original response
and engineering history, and restores an independent editable Workspace.

When the original course already completed, reuse its existing result receipt:

```sh
"$PYTHON" -B "$APPLICATION/source_tools/receive_scientific_report_review.py" \
  --workspace "$WORKSPACE" \
  --continue-receipt "$ORIGINAL_OPERATION/result.json"
```

This does not recreate a report, review, native model case or completed
whole-Workspace archive. The new leg stays under the original operation's
`selected-review/` directory. It reuses a completed selected archive after a
lost response, verifies the original project/review/edition and captured
feedback receipt, and invokes the original selected-study receiving verifier.
An interrupted restore is adopted only after checking every archived member;
a recorded restore can later contain additional original customer responses.

The actual receiver emits `selected-review/result.json`, including the
selected Study ID, archive bytes/SHA, independent Workspace/application paths,
exact captured review history and original source verification. Use the
received application's original operator with that returned Workspace to open
**Customer reviews**, **Read PDF**, **Current requests**, and engineering
handbacks. Sender-local browser caches are rebuilt by those original controls.

### Supply a real returned response

A further invocation can supply an actual response document from the existing
review package:

```sh
"$PYTHON" -B "$APPLICATION/source_tools/receive_scientific_report_review.py" \
  --workspace "$WORKSPACE" \
  --continue-receipt "$ORIGINAL_OPERATION/result.json" \
  --response "$ACTUAL_RETURNED_CUSTOMER_RESPONSE_JSON"
```

The command retains the exact submitted JSON bytes. It imports them **only into
the independent selected received Workspace**, using `reviews.import_response`.
The original review ID, project ID and predecessor rules apply. Exact replay
reuses the existing response. A divergent predecessor is rejected and must be
reconciled through the maintained Customer review UI; this command does not
invent decisions or choose between customer branches.

After import, the original selected-study verifier runs again: the transferred
response prefix, report files and engineering history must still be retained.
The command exports the continued response generation as an ordinary offline
review package and ZIP. Its receipt is
`selected-review/feedback/<original-response-sha256>/result.json`.
If an external package directory is lost after a completed export, its retained
original control files rebuild that exact package before reopening the ZIP.
The donor Workspace's customer responses remain untouched.

The receiving source deliberately leaves the original `receive(...)` API and
its complete-course result unchanged. The optional continuation is a separate
phase of that same retained operation. Existing consumers such as
`receive_observed_scientific_review.py` can finish their ordinary course first
and pass its actual result receipt to this command. Never substitute a fabricated
edition, review or response ID. Install the current Customer review Study-transfer
component and its original native review dependencies before enabling this leg.
