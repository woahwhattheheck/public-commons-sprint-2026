# Prepare and reopen scientific reports

The Sources desk now publishes saved scientific study sections as a complete standalone report. Calibration reviews, Scientific interpretation, native process reports, Monitoring reports and retained observed-water studies all enter through the existing `upstate.observed-report/v1` source contract. Preparing a report uses the maintained scientific formatter and original task queue.

## Operator journey

1. Open the intended Workspace and prepare or import the original study's report source. Its exact source edition remains visible in Sources.
2. In **Sources → Prepare a scientific report**, add the saved studies in reading order. Use **Earlier**, **Later** and **Remove** to set the report order.
3. Enter an optional report title and the preparer's name, organization and email. Contact text appears in the report footer; this operation creates files in the Workspace.
4. Choose **Preview selected sources**. Check each original study title, vintage, document ID and source checksum. The preview binds every selected source and companion before a rendering task is submitted.
5. Choose **Prepare PDF, HTML and data**. The original task panel displays progress and completed download tickets. Refresh saved reports to reopen the completed edition.
6. Open the saved report to read its HTML and download the PDF, Markdown, structured report data, original report inputs, figures and exact selection. **Prepare complete report ZIP** packages those same retained files with the saved operation and edition records.
7. **Transfer this report and its studies** opens the original Study transfer desk with this exact saved edition selected. Preview its ordered source collections and available original Diagnostic, Monitoring and calibration history, then export an editable study. Receive that archive through the existing restore form and reopen the same report in Sources.
8. **Back up Workspace with this report** opens the existing complete Workspace backup workflow when the entire project is required.
9. **Use these studies in another report** loads the saved ordered selection and contact into the composer. The existing edition stays available.

The composer retains its draft for each Workspace in the browser session. Editing the title, contact or order requires a fresh preview. A late preview or file response from another Workspace cannot replace the current selection. Repeating the same prepared identity reuses its completed files. Report sources can come from completed single-model studies; standalone publishing does not require a paired NDR/SDR map baseline.

## Original rendering contract

The existing native command remains at `source/observed-report-20261013/render.py`. Its implementation now calls `model/observed_report_render.py` for the same ordered source binding, PDF/HTML/Markdown/data formatting, immutable selection, completed-file reuse and original portable archive receiving.

The CLI keeps its original `--manifest`, `--title`, `--contact-json`, `--preview`, `--output`, `--archive` and `--receive-directory` arguments. The historical single-source identity remains unchanged when no title override is supplied. Ordered CLI imports still retain the original manifest paths in their source records. The operator selects already-retained sources directly.

The renderer calls `observed_context.bind` and `observed_context.collect`, `scientific_report.report_pdf` and `scientific_report.write_companions`. The scientific sections, numeric quantities, support labels, units, provenance and figure semantics remain owned by those original producers and consumers.

## Saved editions and transport

Each completed operator edition lives under `scientific-report-editions/<full-render-identity-sha256>/` inside the Workspace. It contains the original `selection.json`, `operation.json`, report files and one `edition.json` linking the original project ID to the existing render identity. A received Workspace reopens the preserved identity without substituting its new directory path into the original report.

Rendering and report ZIP creation use the same Workspace lock as complete project backup. Report reads verify the saved selection, operation, source binding and original files. The registered Workspace verification hook performs those checks after receiving. Source mutation between preview and task execution changes the preview identity and requires a new preview.

The report ZIP contains the complete rendered edition and its retained report inputs. Editable Study transfer additionally carries full ordered source collections and the original local study history named by maintained producer contracts. Imported reports retain their contained source files and provenance; missing declared local history is reported before export. The original complete Workspace archive carries the entire project. Downloading a source edition from the adjacent Source reports section still uses its original import manifest and all related scientific source entries.

## Registered operations

| Surface | Existing operator contract |
| --- | --- |
| Typed source and saved edition catalogue | GET /api/source-reports/scientific-catalog |
| Ordered source preview | POST /api/source-reports/scientific-preview |
| Saved edition detail and download tickets | GET /api/source-reports/scientific-edition?id=… |
| Original queue render | source-reports.render |
| Original queue complete report ZIP | source-reports.export |
| Saved item | scientific-report-editions |
| Verified file preview | /api/file/scientific-reports/{workspace}/{edition}/{member} |

The existing SourceReports provider delegates the new operations to `operator/source_report_editions.py`. The same descriptor registers the queue actions, Workspace state, item, download transport and receiving verification. The existing Sources controller mounts `source_report_editions.mjs`; the application supplies its current task panel, refresh and backup form.

## Native receiving continuation

Use the existing ASTRA13 ordered-report receiving operation and real retained original manifests. Run the unchanged CLI preview and render commands against the same original single report and then an ordered pair. Confirm completed-file reuse, original archive receiving, restored source bindings and reopened HTML/PDF/data. On the operator, prepare those same source choices through the original queue, reopen the saved edition, download the report ZIP and restore a complete Workspace into an independent destination. The application source is shared with the existing Monitoring, calibration and diagnostic producers.

## Continue from a prepared study

The registered extension host exposes `openScientificReport({workspace_key, sources, title?})`. The receiving Sources controller verifies the current Workspace, reopens the typed source catalogue, validates all incoming original source choices, and appends missing choices after the user's existing draft order. It preserves the current contact and nonempty title. Duplicate source choices are included once. A completed producer can therefore open the same standalone report composer directly, including single-model diagnostics, while retaining its separate original modeled-delivery action.

## Complete tables across PDF pages

Scientific PDF tables repeat their column headings on each page. Ordinary records stay together when space permits. If one retained cell is longer than a page—for example, a complete list of selected feature IDs, a scientific rationale or an original source reference—the formatter continues that cell on the following pages. Long identifiers wrap at the available column width. Values and links are preserved; the formatter does not shorten source text, delete rows or reduce the scientific table to a sample.

The saved HTML, Markdown and report-data.json continue to carry the complete original table in its original order. Use HTML or the structured data when copying a long identifier; a visual PDF line break is not a new source identifier. The source and report archives retain the corresponding original files.

This uses the existing ReportLab table renderer with both between-row and in-row splitting enabled, while keeping repeated headings. The actual 640a receiver uses ReportLab 4.4.9. The supported behavior is also documented by the original ReportLab 4.4.8 oversized-cell examples: https://hg.reportlab.com/hg-public/reportlab/file/8017a5b19981/tests/test_table_inrowsplit.py . Completed saved editions remain unchanged. A new report preview binds the installed formatter source, so newly prepared editions use the updated pagination.
