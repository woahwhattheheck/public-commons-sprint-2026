# Original observed sources to a saved scientific report and Customer review

The maintained entrypoint source_tools/receive_observed_scientific_review.py completes the source-to-review workflow from an actual saved delivery selection. It uses the same native preview and rendering lifecycle as the SourceReports desk, saves the ordinary scientific-report edition, and calls the existing review/export/Workspace receiving command.

The selected field, laboratory and outcome source documents remain in their original reading order. Their actual source collection IDs, body hashes, methods, figures and complete member trees travel through the report and review package.

## Continue the existing native case

Run the current complete application with the existing original Workspace. Complete the maintained field/laboratory and saved-outcome flow first, then use the actual resulting selection.

receive_implementation_outcome_context.py returns a completed result containing delivery_selection_path and binding. The caller accepts that result directly:

~~~sh
python -B source_tools/receive_observed_scientific_review.py \
  --workspace /path/to/original-workspace \
  --context-receipt /path/to/completed-outcome-context-result.json \
  --review-selection observations/eighteenmile_2023/scientific-review.request.json \
  --title "Eighteenmile 2023 — original scientific source review" \
  --output /path/outside-workspace-and-application/scientific-review-workflow
~~~

The receipt must be the actual completed original outcome-context result. Its project, saved selection path and bound source identities are checked against the selected Workspace.

The same caller also accepts the original saved selection path directly:

~~~sh
python -B source_tools/receive_observed_scientific_review.py \
  --workspace /path/to/original-workspace \
  --delivery-selection ACTUAL_SAVED_DELIVERY_SELECTION_PATH \
  --review-selection observations/eighteenmile_2023/scientific-review.request.json \
  --title "Eighteenmile 2023 — original scientific source review" \
  --output /path/to/scientific-review-workflow
~~~

A relative delivery-selection path is resolved inside the selected Workspace. Use the actual path returned by the preceding source/outcome operation. The input must already contain its complete observed_context_binding and at least one retained source.

For the current Eighteenmile native course, preserve the selection returned by the completed laboratory-source preparation before the outcome is appended. That retains field, laboratory and saved outcome context together. An earlier field-only selection does not automatically acquire a later laboratory source. The caller preserves exactly the supplied ordered sources.

An optional --contact file.json passes the actual report contact object with name, organization and email to the original renderer. With no contact file, those fields remain empty. --created-at can retain a known original review creation timestamp; otherwise the workflow saves one on its first call.

## Internal Eighteenmile review request

The authored request is observations/eighteenmile_2023/scientific-review.request.json. It is an internal review request for the selected original scientific evidence and the project discussion. Its questions cover:

- Original lake-sample coverage and the saved plan/source revision.
- Chlorophyll-a and microcystin analytical methods, units, QA and reporting-limit meanings.
- Numeric, censored and unresolved sample support, including interval endpoints.
- Original activity dates, time offsets and exact same-date comparisons.
- The explicitly selected descriptive periods and reference-site comparison.
- Common-calendar-month support and unavailable balanced comparisons.
- Original figures, numeric specifications and their table interpretation.
- Field/laboratory/outcome ordering and source identities.
- Correct regional geography and the complete reviewer package.

The request contains no fixed Workspace UUID, source collection ID, plan digest or native outcome ID. The current case supplies those from its original records.

The questions refer to the actual intended April–June versus July–October 2023 analysis only if that is the saved selection being reviewed. The receiver does not infer an intervention, change period windows or compute another outcome. Editing the authored review request creates a separately identified workflow for those new questions.

## Shared native preparation

model/scientific_report_editions.py now owns the original SourceReports preview/render lifecycle:

~~~python
prepared = scientific_report_editions.preview(workspace, payload)
saved = scientific_report_editions.render(
    workspace,
    {**payload, "preview_id": prepared["id"]},
)
~~~

payload contains the original ordered sources and optional title/contact. The operator provider delegates these calls and retains its existing preview-conflict response. Its catalogue, saved reports, briefing, study-transfer, file tickets and Customer review actions remain part of the same SourceReports desk.

For a persisted original preview, the native caller uses:

~~~python
saved = scientific_report_editions.render_prepared(workspace, prepared)
~~~

This validates the complete preview identity and ordered source choices, then delegates to the same observed_report_render.render function under the existing Workspace lock. That renderer retains original source members, draws the scientific PDF and figures, writes the HTML/Markdown/data, verifies the installed rendering bodies when needed, and reuses a completed matching edition.

The resulting record lives in the ordinary scientific-report-editions/EDITION_ID directory. It is immediately visible to Open saved report, Prepare customer review, briefing and study-transfer actions in the operator.

## Original preview and transfer continuity

The native workflow retains:

- The complete original saved delivery-selection.
- Its exact relative-path/file descriptor and canonical observed-source binding.
- The authored review JSON and normalized review fields.
- The complete original scientific preview.
- A request containing that full preview file's SHA256/bytes and one creation timestamp.
- The completed saved-edition identity and complete file descriptors.

The preview file includes its enriched source records and human labels, not only render_identity. Reopening verifies the whole file against its retained descriptor.

Original rendering identity contains the source Workspace path. After a complete Workspace transfer, the caller preserves that original identity. It compares the current scientific selection and rendering bodies while permitting the filesystem root to differ, then reopens the original saved edition. It does not replace an original completed report merely because the receiving machine uses a different directory.

An unfinished retained preview continues through the same renderer and its source/code checks. A completed edition keeps its actual original output metadata and member hashes.

The workflow holds a lock in its retained Workspace operation as well as its external output operation. Its request timestamp is recovered from the retained Workspace first, with agreement required if an external copy also exists.

## Review, package and full Workspace receiving

After the scientific edition is saved, the caller invokes source_tools/receive_scientific_report_review.py with the actual edition ID, normalized review request and original creation time.

That maintained receiver:

1. Retains the report's original HTML and complete companions as the existing native review source.
2. Creates or reopens the ordinary Customer review request.
3. Captures the actual existing response generation, including an explicitly empty prefix.
4. Exports and verifies the complete offline reviewer package and ZIP.
5. Retains the exact package control files so their native timestamps survive reconstruction.
6. Backs up the complete Workspace and restores a separate copy.
7. Receives the same review package against its restored original source files.
8. Reopens the saved scientific report and review artifacts with their original identities.

The original delivery-selection is read again after completion and must remain unchanged. The separate restored Workspace receives the same report and review, with the existing response/worklist/reconciliation workflow available.

## Outputs and operator use

Standard error reports actual phases; standard output contains the complete final JSON result. The result identifies:

- Original project, delivery-selection descriptor, source order and full source binding.
- Saved scientific-report edition, source/section/figure counts and all original member descriptors.
- Ordinary review ID, source collection and retained request timestamp.
- Reviewer index.html and the received copy.
- Complete reviewer ZIP and full Workspace archive.
- Restored Workspace/application and the receiver's verification results.
- The complete external result.json and retained workflow directory.

Open reviewer_index from the result to inspect the selected scientific report in the existing offline review desk. Open the restored application with restored_workspace to continue the same native project.

In the running operator, the saved edition is available under Retained source reports. Its Prepare customer review action uses the same model adapter as this command. The resulting ordinary review exposes Export current review, Receive response and Current requests.

## Source closure

The maintained source family includes:

- model/scientific_report_editions.py
- operator/source_report_editions.py
- source_tools/receive_observed_scientific_review.py
- source_tools/RECEIVE_OBSERVED_SCIENTIFIC_REVIEW.md
- observations/eighteenmile_2023/scientific-review.request.json
- The existing scientific-report review adapter and complete receiving command.

Use the full current application for the original renderer, observed-source collectors, figures, reviews and portable Workspace dependencies.
