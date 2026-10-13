# Selected microbial activities in Published studies

Use the measured-source report to choose exact sampling activities, then continue them in the existing Published studies desk. The selected edition retains the original response files, source row numbers, activity identifiers, result fields, reporting limits, methods and routine or field-replicate classification.

## Open the original report and choose activities

1. In **Source reports**, import and open the complete native microbial report edition. Its measured-source explorer contains the original 730 records at 36 stations.
2. Use the measured-source station, date, method text, status and activity-type controls. Select individual rows or **Select all matching activities**. The selection persists when a filter changes; the selected count includes those retained choices.
3. Download **Export selected sample JSON**. The browser filename is `selected-microbial-source-records.json`. This file carries the exact context and observation identities plus each chosen original row.

The full source contains 729 routine samples and one field replicate. A selected cohort can include either activity type; their original series remain separate. Above-limit rows retain empty measured-result cells and their original reporting limits. A sample associated with several assessment records is still one sampling activity.

## Save the selected study

1. Open **Published studies** and expand **Continue selected microbial activities**.
2. Choose the retained original report edition and open the exported JSON. If the report was imported after this desk opened, use **Refresh original reports**.
3. Give the selected study a useful title, then choose **Preview selected activities**. Review the distinct activity and station counts, original date range, routine and replicate counts, result statuses and source rows.
4. Choose **Save selected study**. The existing task queue retains this exact selection and opens the completed study's **Observed series** table.

The server checks the exported records against the retained report and source bytes. An export from a different edition must use that edition's retained report. Editing JSON values cannot substitute measurements or broaden the selected activity set.

The new study has its own identity. Its station, parameter, year and month filters operate within the selected activities. The original complete utility study and the existing 36-station Monitoring course retain their own source identities and choices.

## Review, report and reopen

Inspect a result row to see all original source cells and its exact source CSV row. Save the study's current station and calendar choices with **Save review**; the saved review retains this selected study edition.

In the saved review's **Scientific report** section, choose **Prepare saved review source**. Select the completed source edition. Choose **Open this report only** for a draft containing this saved review, or **Add to current report** to keep the current ordered studies and add this review. The existing composer lets you order it with other explicitly chosen studies, preview the sources, and prepare PDF, HTML and data. Use **Export complete study** for the complete selected study and its source closure, or **Export saved review ZIP** for the saved review and its exact edition. Import either through the existing study or review intake to reopen it in another Workspace.

Original raw response CSVs remain complete, even when the study selects only a few activities. The separate retained activity selector defines the analytical scope after the original source identities, counts and station intervals have been checked. CSV row locators continue to name their positions in the unchanged original response files.

The complete selected JSON, retained source-report provenance and selection identity travel with the study. The original report's broader temporal panels and assessment context retain their stated full-source scope; selected study tables do not relabel those panels as selected-activity calculations.

## Runtime integration

The existing Published studies extension registers:

- Read operations `microbial-selection-catalog` and `microbial-selection-preview`.
- Queued action `published-study.microbial-selection.prepare`.
- Browser component `operator/web/published_microbial_selection.mjs`.
- Source compiler `measurement_workspace.microbial_selection`, using the original `PublishedStudyStore` and observation parser.

A request uses `source_collection_id`, `source_id`, `selection_json` and an optional `title`. The upload is limited to 8 MiB. Preview is read-only; preparation uses the same accepted operation identity on retries. Completed operations cannot replace a study or review the user opened while the task was running.

Deploy the complete selected-activity component together with its compiler and original-record selector. For the complete report workflow, install the existing scientific-report-editions family alongside assessment-source-delivery, or use the complete current application. The assessment-source-delivery component retains the measured report and original sources; Published studies supplies the study store, saved review and prepared scientific source.

## Receive the complete outgoing version

Use the installed application's Python runtime to run the retained example against an existing Workspace and the complete original `native-selection-input/sources.json`:

```bash
python3 examples/selected-microbial-activities-20261013/receive.py \
  --workspace /path/to/existing-workspace \
  --source-manifest /path/to/native-selection-input/sources.json \
  --selection examples/selected-microbial-activities-20261013/qualified-and-replicate-selection.json \
  --output /path/to/selected-study-receiving
```

The same output directory resumes the same request. It retains the imported study, saved-review export, reopened study, scientific-source identity, original report preview and completed report edition. `receiving.json` gives the actual scientific PDF, HTML and structured-data paths.

Open and operate this exact outgoing application. Inspect the populated seven-activity table at desktop/screenshare and narrow/mobile sizes, along with empty, loading and error states. Save the selected study and review, prepare the scientific source, and exercise both composer choices: **Add to current report** preserves an existing calendar source in order; **Open this report only** selects just this review. Download and reopen the exported files, extract the complete study/review archives and open their contained report and working study. Open the final PDF and HTML and look at the actual rendered pages, source labels, tables and qualifier descriptions. The producing peer must inspect the returned screenshots or render locally and repair any unreadable, clipped or broken output before using that outgoing version with a prospect. Retain the existing receiving Workspace and operation while making corrections.
